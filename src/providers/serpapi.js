/**
 * SerpApi "Google Hotels" provider. Reliable and runs fine from GitHub Actions,
 * but it is a paid API: 33 properties x 3 date windows = 99 searches per run,
 * 12 runs/day = ~1,200 searches/day. Set SERPAPI_KEY to use it.
 *
 * Docs: https://serpapi.com/google-hotels-api
 */
import { parsePrice, normalizeName, withRetry } from '../util.js';

const BASE = 'https://serpapi.com/search.json';

async function serp(params) {
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error('SERPAPI_KEY is not set');
  const url = new URL(BASE);
  for (const [k, v] of Object.entries({ engine: 'google_hotels', gl: 'in', hl: 'en', currency: 'INR', api_key: key, ...params })) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    const msg = body.error || `HTTP ${res.status}`;
    // "hasn't returned any results" is SerpApi's way of saying nothing for these dates, not a failure.
    if (/hasn't returned any results|no results/i.test(msg)) return { properties: [], _empty: true };
    throw new Error(`SerpApi: ${msg}`);
  }
  return body;
}

function pickMatch(property, list) {
  const wanted = [property.name, ...(property.aliases || []), property.query].map(normalizeName);
  const scored = list.map((p) => {
    const n = normalizeName(p.name);
    let score = 0;
    for (const w of wanted) {
      if (n === w) score = Math.max(score, 100);
      else if (n.includes(w) || w.includes(n)) score = Math.max(score, 80);
      else {
        const overlap = w.split(' ').filter((t) => t.length > 2 && n.includes(t)).length;
        score = Math.max(score, Math.round((overlap / Math.max(1, w.split(' ').length)) * 70));
      }
    }
    if (/saltstayz|golden tulip|patio farms|pause/.test(n)) score += 5;
    return { p, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 45 ? scored[0].p : null;
}

function extractPrices(detail) {
  const out = [];
  const seen = new Set();
  for (const p of [...(detail.featured_prices || []), ...(detail.prices || [])]) {
    const price = parsePrice(p.rate_per_night?.extracted_lowest ?? p.rate_per_night?.lowest);
    if (price == null) continue;
    const k = `${p.source}|${price}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ source: p.source, price, official: !!p.official });
  }
  return out;
}

export default {
  name: 'serpapi',
  async init() {},
  async close() {},

  async fetchPrices(property, window, settings) {
    const dates = { check_in_date: window.checkIn, check_out_date: window.checkOut, adults: settings.adults || 2 };
    return withRetry(async () => {
      let token = property.googleToken || null;
      let matchedName = null;

      if (!token) {
        const search = await serp({ q: property.query, ...dates });
        const match = pickMatch(property, search.properties || []);
        if (!match) return { availability: 'not_found', matchedName: null, prices: [], note: 'Could not find this hotel on Google Hotels.', pricesFor: null, token: null };
        token = match.property_token;
        matchedName = match.name;
      }

      const detail = await serp({ q: property.query, property_token: token, ...dates });
      if (detail._empty || (!detail.name && !detail.prices)) {
        // Token may have expired; search once more without it.
        if (property.googleToken) return this.fetchPrices({ ...property, googleToken: null }, window, settings);
        return { availability: 'no_rooms', matchedName, prices: [], note: 'No rooms tonight on Google.', pricesFor: null, token };
      }
      const prices = extractPrices(detail);
      return {
        availability: prices.length ? 'available' : 'sold_out',
        matchedName: detail.name || matchedName,
        prices,
        note: prices.length ? '' : 'Sold out tonight on Google. No prices shown.',
        pricesFor: null,
        token,
      };
    }, { retries: settings.crawl?.retries ?? 2, delayMs: settings.crawl?.retryDelayMs ?? 3000, label: property.name });
  },
};
