/**
 * One full run: crawl every property for every date window, compare, save history,
 * render the dashboard, and send alerts. Safe to run as often as you like.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, loadSettings, loadProperties, mapLimit, writeJson, readJson } from './util.js';
import { buildWindows, runId, formatStamp } from './dates.js';
import { getProvider } from './providers/index.js';
import { compareProperty, summarize, sortRows } from './compare.js';
import { renderDashboard } from './report.js';
import { loadState, saveState, diffDeviations } from './state.js';
import { subject, textBody, htmlBody, shortBody } from './notify/format.js';
import { sendEmail, emailStatus } from './notify/email.js';
import { sendWhatsApp, whatsappStatus } from './notify/whatsapp.js';

const settings = loadSettings();
const properties = loadProperties();
const now = new Date();
const windows = buildWindows(settings, now);
const id = runId(settings.timezone, now);
const dryRun = process.env.DRY_RUN === '1';
const provider = await getProvider();
const state = loadState();

console.log(`Saltstayz rate parity · run ${id} · provider ${provider.name} · ${properties.length} properties · windows ${windows.map((w) => w.checkIn).join(', ')}`);

// 1. Crawl
await provider.init(settings);
const results = {};
try {
  const jobs = windows.flatMap((w) => properties.map((p) => ({ p, w })));
  await mapLimit(jobs, settings.crawl?.concurrency || 2, async ({ p, w }) => {
    const prop = { ...p, googleToken: p.googleToken || state.tokens?.[p.id] || null };
    try {
      const raw = await provider.fetchPrices(prop, w, settings);
      results[`${p.id}|${w.key}`] = raw;
      if (raw.token) state.tokens = { ...(state.tokens || {}), [p.id]: raw.token };
      const n = raw.prices?.length || 0;
      console.log(`  ${w.key} ${p.name}: ${raw.availability}${n ? `, ${n} prices` : ''}`);
    } catch (err) {
      results[`${p.id}|${w.key}`] = { availability: 'error', prices: [], note: `Crawl failed: ${err.message}` };
      console.error(`  ${w.key} ${p.name}: ERROR ${err.message}`);
    }
  });
} finally {
  await provider.close();
}

// 2. Compare
const run = {
  id,
  stamp: formatStamp(now, settings.timezone),
  generatedAt: now.toISOString(),
  provider: provider.name,
  adults: settings.adults || 2,
  scheduled: process.env.GITHUB_ACTIONS ? 'GitHub Actions' : process.env.SCHEDULER || '',
  indianOtasVisible: provider.indianOtasVisible ?? null,
  windows: windows.map((w) => {
    const rows = sortRows(properties.map((p) => compareProperty(p, results[`${p.id}|${w.key}`], settings)));
    return { key: w.key, checkIn: w.checkIn, checkOut: w.checkOut, label: w.label, summary: summarize(rows, settings), rows };
  }),
};

// 3. Diff against last run and notify
const diff = diffDeviations(state.openDeviations || {}, run.windows);
const total = Object.keys(diff.current).length;
const changed = diff.added.length > 0 || diff.resolved.length > 0;
const shouldNotify = !dryRun && (settings.notifications.mode === 'always' ? total > 0 : changed);
run.notifications = {
  email: { ...emailStatus(), sent: false, reason: emailStatus().configured ? (shouldNotify ? '' : 'Nothing to send this run.') : `No email sender is connected yet, so no alerts went out for this run. (missing ${emailStatus().missing.join(', ')})` },
  whatsapp: { ...whatsappStatus(), sent: false, reason: whatsappStatus().configured ? (shouldNotify ? '' : 'Nothing to send this run.') : `Needs a WhatsApp Business number and an approved message template. (missing ${whatsappStatus().missing.join(', ')})` },
};
if (shouldNotify) {
  try {
    const r = await sendEmail({ subject: subject(run, diff), text: textBody(run, diff, settings), html: htmlBody(run, diff, settings) });
    run.notifications.email = { ...run.notifications.email, ...r };
    console.log('Email:', r.sent ? `sent to ${r.to.join(', ')}` : r.reason);
  } catch (err) { run.notifications.email.reason = `Email failed: ${err.message}`; console.error(run.notifications.email.reason); }
  try {
    const r = await sendWhatsApp(shortBody(run, diff, settings));
    run.notifications.whatsapp = { ...run.notifications.whatsapp, ...r };
    console.log('WhatsApp:', r.sent ? `sent via ${r.via}` : r.reason);
  } catch (err) { run.notifications.whatsapp.reason = `WhatsApp failed: ${err.message}`; console.error(run.notifications.whatsapp.reason); }
}
run.diff = { added: diff.added, ongoing: diff.ongoing, resolved: diff.resolved };

// 4. Save history, dashboard, state
const runFile = path.join(ROOT, 'data', 'runs', id.slice(0, 10), `${id.slice(11)}.json`);
writeJson(runFile, run);
writeJson(path.join(ROOT, 'docs', 'latest.json'), run);
const histFile = path.join(ROOT, 'docs', 'history.json');
const history = readJson(histFile, []);
history.push({
  id, generatedAt: run.generatedAt,
  windows: run.windows.map((w) => ({ key: w.key, checkIn: w.checkIn, ...w.summary })),
  deviations: total, added: diff.added.length, resolved: diff.resolved.length,
  // Short snapshot of who was undercut, so the History tab can show it without opening the run file.
  undercut: Object.values(diff.current).map((d) => d.kind === 'direct_missing' ? `${d.property} (${d.window}): Saltstayz.com missing, ${d.source} ₹${d.otaPrice.toLocaleString('en-IN')}` : `${d.property} (${d.window}): ${d.source} ₹${d.otaPrice.toLocaleString('en-IN')} vs ₹${d.direct.toLocaleString('en-IN')}, ${d.gapPercent}% lower`),
});
const trimmed = history.slice(-(settings.history?.keepRuns || 500));
writeJson(histFile, trimmed);
fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), renderDashboard(run, settings, trimmed, settings.repoUrl || process.env.REPO_URL || ''));
if (!dryRun) saveState({ ...state, lastRunId: id, openDeviations: diff.current });

// 5. Console summary
for (const w of run.windows) {
  const s = w.summary;
  console.log(`${w.key} ${w.checkIn}: ${s.otaLower} OTA-lower · ${s.directLowest} Saltstayz-lowest · ${s.directMissing} direct-missing · ${s.notOnGoogle} not-on-Google · ${s.unavailable} unavailable · ${s.errors} errors`);
}
console.log(`Deviations: ${total} (${diff.added.length} new, ${diff.resolved.length} resolved) · dashboard docs/index.html · ${runFile.replace(ROOT + '/', '')}`);
if (process.env.FAIL_ON_ERRORS === '1' && run.windows.some((w) => w.summary.errors === w.summary.total)) {
  console.error('Every property failed to crawl. Marking the run as failed.');
  process.exit(2);
}
