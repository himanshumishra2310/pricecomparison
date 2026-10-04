/**
 * Renders the dashboard (docs/index.html) in the same style as the original one-off report:
 * deep-green header, cream background, summary tiles, one comparison table per date window.
 */
import { formatInr } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUS = {
  ota_lower: (r) => ({ cls: 'bad', text: `${r.lowest.source} lower by ${r.deviations[0].gapPercent}%` }),
  direct_missing: () => ({ cls: 'bad', text: 'Saltstayz.com missing' }),
  direct_lowest: () => ({ cls: 'good', text: 'Saltstayz lowest' }),
  no_rooms: () => ({ cls: 'warn', text: 'Not available' }),
  sold_out: () => ({ cls: 'muted', text: 'Sold out' }),
  no_prices: () => ({ cls: 'muted', text: 'No prices' }),
  not_on_google: () => ({ cls: 'muted', text: 'Not on Google' }),
  error: () => ({ cls: 'muted', text: 'Crawl error' }),
};

function cell(value, { lowestOf, isDirect, direct }) {
  if (value == null) return '<td class="num">—</td>';
  const isLowest = lowestOf != null && value === lowestOf;
  const cheaperThanDirect = !isDirect && direct != null && value < direct;
  const cls = ['num', isLowest && isDirect ? 'direct-win' : '', isLowest && !isDirect ? 'ota-win' : '', cheaperThanDirect && !isLowest ? 'ota-cheaper' : ''].filter(Boolean).join(' ');
  return `<td class="${cls}">${formatInr(value)}</td>`;
}

function row(r, settings) {
  const st = (STATUS[r.status] || STATUS.error)(r);
  const prices = [r.direct, ...Object.values(r.otas)].filter((v) => v != null);
  // Highlight the winner: green on Saltstayz.com only when it truly is the lowest (including untracked OTAs),
  // red on the cheapest tracked OTA cell when an OTA wins.
  const lowestOf = r.status === 'direct_lowest' ? r.direct : r.status === 'ota_lower' && r.deviations[0].tracked ? r.deviations[0].price : null;
  const notes = [];
  if (r.note) notes.push(r.note);
  if (r.others?.length) notes.push('Also cheaper: ' + r.others.map((o) => `${o.source} ${formatInr(o.price)}`).join(', '));
  if (r.nameMismatch) notes.push(`Google lists this only as “${r.matchedName}”. Please confirm the match.`);
  return `<tr class="st-${r.status}">
    <td class="prop"><div class="name">${esc(r.name)}</div>${notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}</td>
    ${cell(r.direct, { lowestOf, isDirect: true, direct: r.direct })}
    ${settings.trackedOtas.map((o) => cell(r.otas[o.key], { lowestOf, isDirect: false, direct: r.direct })).join('')}
    <td>${r.lowest ? esc(r.lowest.source) : '—'}</td>
    <td><span class="pill ${st.cls}">${esc(st.text)}</span></td>
  </tr>`;
}

function tiles(s) {
  const pct = (v, sign = false) => (v == null ? '—' : `${sign && v > 0 ? '+' : ''}${v}%`);
  const color = (v, goodWhenPositive = true) => (v == null ? '' : (goodWhenPositive ? v >= 0 : v <= 0) ? 'g' : 'r');
  return `<div class="tiles">
    <div class="tile"><div class="big ${s.pctDirectLowest == null ? '' : s.pctDirectLowest >= 50 ? 'g' : 'r'}">${pct(s.pctDirectLowest)}</div><div class="lbl">Properties where Saltstayz.com is lowest</div><div class="sub">${s.directLowest} lowest, ${s.otaLower} undercut by an OTA${s.directMissing ? `, ${s.directMissing} missing direct price` : ''}</div></div>
    <div class="tile"><div class="big ${color(s.avgGapNearestOta)}">${pct(s.avgGapNearestOta, true)}</div><div class="lbl">Avg gap: Saltstayz vs nearest OTA</div><div class="sub">Cheapest tracked OTA vs Saltstayz.com. Plus means the OTA is dearer, minus means it is cheaper.</div></div>
    <div class="tile"><div class="big g">${pct(s.avgGapWhereDirectLowest, true)}</div><div class="lbl">Avg gap where Saltstayz is lowest</div><div class="sub">How much dearer the other tracked OTAs are, on average.</div></div>
    <div class="tile"><div class="big r">${pct(s.avgGapWhereOtaLowest, true)}</div><div class="lbl">Avg gap where an OTA is lowest</div><div class="sub">How much cheaper the lowest OTA is than Saltstayz.com, on average.</div></div>
  </div>`;
}

function alertCard(title, status, text) {
  return `<div class="card"><div class="ct">${esc(title)}</div><span class="pill ${status.cls}">${esc(status.text)}</span> <span class="cs">${esc(text)}</span></div>`;
}

export function renderDashboard(run, settings) {
  const otaHeads = settings.trackedOtas.map((o) => `<th class="num">${esc(o.label)}</th>`).join('');
  const sections = run.windows.map((w, i) => `
    <section class="win" id="${w.key}" ${i ? 'hidden' : ''}>
      <h2>Summary · ${w.summary.comparable} of ${w.summary.total} properties comparable · ${esc(w.label)}</h2>
      ${tiles(w.summary)}
      <h2>Property comparison</h2>
      <div class="tablewrap"><table>
        <thead><tr><th>Property</th><th class="num">Saltstayz.com</th>${otaHeads}<th>Lowest platform</th><th>Status</th></tr></thead>
        <tbody>${w.rows.map((r) => row(r, settings)).join('')}</tbody>
      </table></div>
    </section>`).join('');

  const tabs = run.windows.map((w, i) => `<button class="tab ${i ? '' : 'on'}" data-win="${w.key}">${w.key} · ${esc(w.checkIn)} <span class="cnt ${w.summary.otaLower + w.summary.directMissing ? 'r' : 'g'}">${w.summary.otaLower + w.summary.directMissing}</span></button>`).join('');
  const n = run.notifications || {};
  const alerts = `<h2>Alerts</h2><div class="cards">
    ${alertCard('Email', n.email?.sent ? { cls: 'good', text: 'Sent' } : { cls: 'muted', text: 'Not sending' }, n.email?.sent ? `Sent to ${(n.email.to || []).join(', ')}.` : n.email?.reason || 'No email sender is connected yet.')}
    ${alertCard('WhatsApp', n.whatsapp?.sent ? { cls: 'good', text: 'Sent' } : { cls: 'muted', text: 'Not sending' }, n.whatsapp?.sent ? `Sent via ${n.whatsapp.via}.` : n.whatsapp?.reason || 'Needs a WhatsApp Business number and an approved message template.')}
    ${alertCard('Schedule', run.scheduled ? { cls: 'good', text: 'Every 2 hours' } : { cls: 'muted', text: 'Manual' }, run.scheduled ? `Runs automatically via ${esc(run.scheduled)}. Data source: ${esc(run.provider)}.` : `This run was started by hand (${esc(run.provider)}). Automatic runs every 2 hours are set up in GitHub Actions.`)}
  </div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saltstayz Rate Parity</title>
<style>
:root{--green:#4a6b2f;--cream:#f6f4ee;--ink:#222;--muted:#6b6b6b;--line:#e6e2d8;--red:#b3261e;--redbg:#fbe9e7;--okbg:#e8efdf;--ok:#3f6b1f;--warnbg:#fbf1cf;--warn:#7a5a00}
*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--ink);font:14px/1.45 Lato,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif}
header{background:var(--green);color:#fff;padding:22px 32px}header h1{margin:0 0 6px;font-size:22px}header p{margin:0;opacity:.92;font-size:13px}
main{padding:20px 32px 48px;max-width:1500px;margin:0 auto}
h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5a5a5a;margin:26px 0 10px}
.banner{background:var(--warnbg);color:var(--warn);border:1px solid #efdc9a;border-radius:10px;padding:10px 14px;margin-top:18px;font-weight:600}
.tabs{display:flex;gap:8px;margin-top:18px;flex-wrap:wrap}.tab{border:1px solid var(--line);background:#fff;border-radius:999px;padding:8px 14px;font:inherit;font-weight:700;color:#444;cursor:pointer}.tab.on{background:var(--green);color:#fff;border-color:var(--green)}
.cnt{display:inline-block;min-width:20px;padding:0 6px;border-radius:999px;background:#fff;font-size:12px;text-align:center;margin-left:4px}.cnt.r{color:var(--red)}.cnt.g{color:var(--ok)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.tile{background:#fff;border:1px solid var(--line);border-radius:12px;padding:18px 20px}.big{font-size:32px;font-weight:800;line-height:1.1}.big.g{color:var(--ok)}.big.r{color:var(--red)}.lbl{margin-top:8px;font-weight:600}.sub{color:var(--muted);font-size:12px;margin-top:6px}
.tablewrap{background:#fff;border:1px solid var(--line);border-radius:12px;overflow:auto}table{border-collapse:collapse;width:100%;min-width:900px}th{text-align:left;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#5a5a5a;padding:12px 14px;border-bottom:1px solid var(--line);background:#faf9f5}td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:top}tr:last-child td{border-bottom:0}
th.num,td.num{text-align:right;white-space:nowrap}.prop{min-width:300px}.name{font-weight:700}.note{color:var(--muted);font-size:12px;margin-top:4px;max-width:360px}
td.direct-win{color:var(--ok);font-weight:700}td.ota-win{background:var(--redbg);color:var(--red);font-weight:700}td.ota-cheaper{color:var(--red)}
.pill{display:inline-block;border-radius:999px;padding:4px 11px;font-size:12px;font-weight:700;white-space:nowrap}.pill.bad{background:var(--redbg);color:var(--red)}.pill.good{background:var(--okbg);color:var(--ok)}.pill.warn{background:var(--warnbg);color:var(--warn)}.pill.muted{background:#ecebe6;color:#666}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:16px 18px}.ct{font-weight:700;margin-bottom:8px}.cs{color:#444}
footer{color:var(--muted);font-size:12px;margin-top:28px}
@media(max-width:700px){header,main{padding-left:16px;padding-right:16px}}
</style></head>
<body>
<header><h1>Saltstayz Rate Parity</h1><p>Google Hotels listing prices · Saltstayz.com vs ${settings.trackedOtas.map((o) => esc(o.label)).join(', ')} · ${run.adults} adults, per night incl. taxes · checked ${esc(run.stamp)}</p></header>
<main>
  ${run.provider === 'fixture' ? '<div class="banner">Sample data replayed from the one-off Chrome crawl of 4 Oct 2026. The first scheduled run replaces this page with live Google Hotels prices.</div>' : ''}
  <div class="tabs">${tabs}</div>
  ${sections}
  ${alerts}
  <footer>Run ${esc(run.id)} · ${run.windows.reduce((a, w) => a + w.rows.length, 0) / run.windows.length} properties · data source: ${esc(run.provider)} · <a href="latest.json">latest.json</a> · <a href="history.json">history.json</a></footer>
</main>
<script>
document.querySelectorAll('.tab').forEach(function(b){b.addEventListener('click',function(){document.querySelectorAll('.tab').forEach(function(x){x.classList.toggle('on',x===b)});document.querySelectorAll('.win').forEach(function(s){s.hidden=s.id!==b.dataset.win});location.hash=b.dataset.win})});
if(location.hash){var t=document.querySelector('.tab[data-win="'+location.hash.slice(1)+'"]');if(t)t.click()}
</script>
</body></html>`;
}
