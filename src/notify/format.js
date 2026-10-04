import { formatInr } from '../util.js';

function line(d) {
  if (d.kind === 'direct_missing') return `${d.property} (${d.window}): Saltstayz.com price missing, ${d.source} selling at ${formatInr(d.otaPrice)}`;
  return `${d.property} (${d.window}): ${d.source} ${formatInr(d.otaPrice)} vs Saltstayz.com ${formatInr(d.direct)} (lower by ${d.gapPercent}%)`;
}

export function subject(run, diff) {
  const n = Object.keys(diff.current).length;
  if (!n) return `Saltstayz rate parity: all clear (${run.stamp})`;
  return `Saltstayz rate parity: ${n} deviation${n === 1 ? '' : 's'}, ${diff.added.length} new (${run.stamp})`;
}

/** Plain-text body, also used for WhatsApp. */
export function textBody(run, diff, settings) {
  const out = [];
  out.push(`Saltstayz Rate Parity · checked ${run.stamp}`);
  out.push(`Windows: ${run.windows.map((w) => `${w.key} ${w.checkIn}`).join(', ')} · ${run.adults} adults · 1 night · incl. taxes`);
  out.push('');
  for (const w of run.windows) {
    const s = w.summary;
    out.push(`${w.key} ${w.checkIn}: ${s.otaLower} OTA-lower, ${s.directLowest} Saltstayz-lowest, ${s.directMissing} direct-missing, ${s.comparable}/${s.total} comparable`);
  }
  out.push('');
  if (diff.added.length) { out.push(`NEW since last check (${diff.added.length}):`); diff.added.forEach((d) => out.push('• ' + line(d))); out.push(''); }
  if (diff.ongoing.length) { out.push(`Still open (${diff.ongoing.length}):`); diff.ongoing.forEach((d) => out.push('• ' + line(d))); out.push(''); }
  if (settings.notifications.includeResolved && diff.resolved.length) { out.push(`Resolved (${diff.resolved.length}):`); diff.resolved.forEach((d) => out.push('• ' + line(d))); out.push(''); }
  if (!Object.keys(diff.current).length) out.push('No OTA is undercutting Saltstayz.com right now.');
  if (settings.notifications.dashboardUrl) out.push(`Dashboard: ${settings.notifications.dashboardUrl}`);
  return out.join('\n');
}

/** Short version for WhatsApp (keeps under ~1,000 chars). */
export function shortBody(run, diff, settings) {
  const n = Object.keys(diff.current).length;
  const parts = [`Saltstayz parity ${run.stamp}: ${n} deviation${n === 1 ? '' : 's'} (${diff.added.length} new).`];
  const top = [...diff.added, ...diff.ongoing].sort((a, b) => (b.gapPercent || 0) - (a.gapPercent || 0)).slice(0, 8);
  for (const d of top) parts.push(d.kind === 'direct_missing' ? `${d.property} ${d.window}: direct missing, ${d.source} ${formatInr(d.otaPrice)}` : `${d.property} ${d.window}: ${d.source} ${formatInr(d.otaPrice)} < ${formatInr(d.direct)} (-${d.gapPercent}%)`);
  if (n > top.length) parts.push(`…and ${n - top.length} more.`);
  if (settings.notifications.dashboardUrl) parts.push(settings.notifications.dashboardUrl);
  return parts.join('\n');
}

export function htmlBody(run, diff, settings) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const section = (title, items, color) => items.length ? `<h3 style="margin:18px 0 6px;color:${color}">${title} (${items.length})</h3><ul style="padding-left:18px;margin:0">${items.map((d) => `<li style="margin:3px 0">${esc(line(d))}</li>`).join('')}</ul>` : '';
  const rows = run.windows.map((w) => `<tr><td style="padding:4px 10px 4px 0"><b>${w.key}</b> ${esc(w.checkIn)}</td><td style="padding:4px 10px">${w.summary.otaLower} OTA lower</td><td style="padding:4px 10px">${w.summary.directLowest} Saltstayz lowest</td><td style="padding:4px 10px">${w.summary.directMissing} direct missing</td><td style="padding:4px 10px;color:#777">${w.summary.comparable}/${w.summary.total} comparable</td></tr>`).join('');
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#222;max-width:720px">
  <div style="background:#4a6b2f;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0"><div style="font-size:18px;font-weight:700">Saltstayz Rate Parity</div><div style="opacity:.9;font-size:12px">Google Hotels listing prices · checked ${esc(run.stamp)} · ${run.adults} adults · 1 night · incl. taxes</div></div>
  <div style="border:1px solid #e3e0d6;border-top:0;padding:14px 18px;border-radius:0 0 8px 8px;background:#fff">
    <table style="border-collapse:collapse;font-size:13px">${rows}</table>
    ${section('New since last check', diff.added, '#b3261e')}
    ${section('Still open', diff.ongoing, '#8a5a00')}
    ${settings.notifications.includeResolved ? section('Resolved', diff.resolved, '#2e7d32') : ''}
    ${!Object.keys(diff.current).length ? '<p style="color:#2e7d32;font-weight:600;margin-top:16px">No OTA is undercutting Saltstayz.com right now.</p>' : ''}
    ${settings.notifications.dashboardUrl ? `<p style="margin-top:18px"><a href="${esc(settings.notifications.dashboardUrl)}" style="color:#4a6b2f;font-weight:600">Open the live dashboard →</a></p>` : ''}
  </div></div>`;
}
