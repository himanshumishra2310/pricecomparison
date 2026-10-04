/**
 * Turns raw crawl results into a per-property verdict for one date window.
 *
 * Input (one property, one window):
 *   { availability: 'available' | 'not_found' | 'sold_out' | 'no_rooms' | 'error',
 *     prices: [{ source: 'Agoda', price: 2304, official: false }, ...],
 *     note: 'optional free text', matchedName: 'Saltstayz Premier' }
 *
 * Output row fields:
 *   direct: Saltstayz.com price or null
 *   otas: { makemytrip: 2332, goibibo: null, ... }  (tracked OTA columns)
 *   others: [{ source, price }]                    (untracked OTAs that are cheaper than direct)
 *   lowest: { source, price } or null              (cheapest platform overall)
 *   status: 'ota_lower' | 'direct_lowest' | 'direct_missing' | 'not_on_google' | 'sold_out' | 'no_rooms' | 'error' | 'no_prices'
 *   deviations: [{ source, price, gapRupees, gapPercent, tracked }]
 */

function matchChannel(source, matchers) {
  const s = String(source || '').toLowerCase();
  return matchers.some((m) => s.includes(m));
}

export function classifySource(source, settings) {
  if (matchChannel(source, settings.directChannel.matchers)) return { kind: 'direct' };
  for (const ota of settings.trackedOtas) {
    if (matchChannel(source, ota.matchers)) return { kind: 'tracked', key: ota.key, label: ota.label };
  }
  return { kind: 'other', label: source };
}

export function compareProperty(property, raw, settings) {
  const row = {
    id: property.id,
    name: property.name,
    brand: property.brand,
    city: property.city,
    matchedName: raw?.matchedName || null,
    nameMismatch: false,
    direct: null,
    otas: Object.fromEntries(settings.trackedOtas.map((o) => [o.key, null])),
    others: [],
    lowest: null,
    status: 'no_prices',
    deviations: [],
    note: raw?.note || '',
    pricesFor: raw?.pricesFor || null,
  };

  if (!raw || raw.availability === 'error') {
    row.status = 'error';
    row.note = raw?.note || 'Crawl failed for this property.';
    return row;
  }
  if (raw.availability === 'not_found') {
    row.status = 'not_on_google';
    row.note = row.note || 'Could not find this hotel on Google Hotels.';
    return row;
  }

  // Collect the lowest price per channel.
  const all = [];
  for (const p of raw.prices || []) {
    if (p.price == null) continue;
    const cls = p.official ? { kind: 'direct' } : classifySource(p.source, settings);
    if (cls.kind === 'direct') {
      row.direct = row.direct == null ? p.price : Math.min(row.direct, p.price);
    } else if (cls.kind === 'tracked') {
      const cur = row.otas[cls.key];
      row.otas[cls.key] = cur == null ? p.price : Math.min(cur, p.price);
      all.push({ source: cls.label, key: cls.key, price: p.price, tracked: true });
    } else {
      all.push({ source: p.source, price: p.price, tracked: false });
    }
  }
  // Collapse untracked sources to their minimum each.
  const otaMin = new Map();
  for (const a of all) {
    const k = a.key || a.source;
    const cur = otaMin.get(k);
    if (!cur || a.price < cur.price) otaMin.set(k, a);
  }
  const otas = [...otaMin.values()].sort((a, b) => a.price - b.price);

  if (raw.availability === 'sold_out' || raw.availability === 'no_rooms' || raw.availability === 'no_prices') {
    row.status = raw.availability;
    if (raw.availability === 'sold_out') row.note = row.note || 'Sold out tonight on Google.';
    // Still compute what is visible so the dashboard shows it, but no deviation is raised.
    row.lowest = otas[0] && (row.direct == null || otas[0].price < row.direct) ? { source: otas[0].source, price: otas[0].price } : row.direct != null ? { source: settings.directChannel.label, price: row.direct } : null;
    return row;
  }

  if (row.direct == null && otas.length === 0) {
    row.status = 'no_prices';
    row.note = row.note || 'Google shows no Saltstayz.com or OTA price.';
    return row;
  }

  if (row.direct == null) {
    row.status = 'direct_missing';
    row.note = row.note || 'Saltstayz.com price not shown on Google. OTAs are selling.';
    row.lowest = { source: otas[0].source, price: otas[0].price };
    if (settings.deviation.flagMissingDirectPrice) {
      row.deviations.push({ source: otas[0].source, price: otas[0].price, gapRupees: null, gapPercent: null, tracked: !!otas[0].tracked, kind: 'direct_missing' });
    }
    return row;
  }

  const { minGapRupees = 0, minGapPercent = 0, anyOtaCountsAsDeviation = true } = settings.deviation;
  for (const o of otas) {
    if (!o.tracked && !anyOtaCountsAsDeviation) continue;
    const gapRupees = row.direct - o.price;
    const gapPercent = (gapRupees / row.direct) * 100;
    if (gapRupees > 0 && gapRupees >= minGapRupees && gapPercent >= minGapPercent) {
      row.deviations.push({ source: o.source, price: o.price, gapRupees, gapPercent: +gapPercent.toFixed(1), tracked: !!o.tracked, kind: 'ota_lower' });
    }
  }
  row.others = otas.filter((o) => !o.tracked && o.price < row.direct).map((o) => ({ source: o.source, price: o.price }));

  if (row.deviations.length) {
    const worst = row.deviations[0];
    row.status = 'ota_lower';
    row.lowest = { source: worst.source, price: worst.price };
  } else {
    row.status = 'direct_lowest';
    row.lowest = { source: settings.directChannel.label, price: row.direct };
  }
  if (row.matchedName && property.name && !sameHotel(property, row.matchedName)) {
    row.nameMismatch = true;
  }
  return row;
}

function sameHotel(property, matchedName) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const m = norm(matchedName);
  const candidates = [property.name, ...(property.aliases || [])].map(norm);
  return candidates.some((c) => c === m || c.includes(m) && m.length >= c.length * 0.6 || m.includes(c));
}

/** Summary tiles for one window. */
export function summarize(rows, settings) {
  const comparable = rows.filter((r) => r.status === 'ota_lower' || r.status === 'direct_lowest');
  const directLowest = comparable.filter((r) => r.status === 'direct_lowest');
  const otaLower = comparable.filter((r) => r.status === 'ota_lower');
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  // Gap vs the cheapest *tracked* OTA that has a price, as a % of the direct rate. + means OTA is dearer.
  const trackedGap = comparable
    .map((r) => {
      const tracked = Object.values(r.otas).filter((v) => v != null);
      if (!tracked.length) return null;
      return ((Math.min(...tracked) - r.direct) / r.direct) * 100;
    })
    .filter((x) => x != null);
  const gapWhereDirectLowest = directLowest
    .map((r) => {
      const tracked = Object.values(r.otas).filter((v) => v != null);
      return tracked.length ? ((Math.min(...tracked) - r.direct) / r.direct) * 100 : null;
    })
    .filter((x) => x != null);
  const gapWhereOtaLowest = otaLower.map((r) => -r.deviations[0].gapPercent);

  return {
    total: rows.length,
    comparable: comparable.length,
    directLowest: directLowest.length,
    otaLower: otaLower.length,
    directMissing: rows.filter((r) => r.status === 'direct_missing').length,
    notOnGoogle: rows.filter((r) => r.status === 'not_on_google').length,
    unavailable: rows.filter((r) => ['sold_out', 'no_rooms', 'no_prices'].includes(r.status)).length,
    errors: rows.filter((r) => r.status === 'error').length,
    pctDirectLowest: comparable.length ? Math.round((directLowest.length / comparable.length) * 100) : null,
    avgGapNearestOta: round1(avg(trackedGap)),
    avgGapWhereDirectLowest: round1(avg(gapWhereDirectLowest)),
    avgGapWhereOtaLowest: round1(avg(gapWhereOtaLowest)),
  };
}

const round1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

/** Sort: deviations first (largest gap first), then missing, then not available, then direct lowest. */
export function sortRows(rows) {
  const rank = { ota_lower: 0, direct_missing: 1, no_rooms: 2, sold_out: 3, no_prices: 4, error: 5, direct_lowest: 6, not_on_google: 7 };
  return [...rows].sort((a, b) => {
    const r = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (r !== 0) return r;
    if (a.status === 'ota_lower') return (b.deviations[0]?.gapPercent || 0) - (a.deviations[0]?.gapPercent || 0);
    return a.name.localeCompare(b.name);
  });
}
