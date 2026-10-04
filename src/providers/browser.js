/**
 * Browser provider: opens Google Hotels in Chromium (Playwright), searches the property,
 * sets the check-in/check-out dates, opens the "Prices" tab and reads every platform's price.
 *
 * Free, but Google can show a CAPTCHA / "unusual traffic" page to data-centre IPs. It works
 * best from a normal machine (your Mac) or with BROWSER_CHANNEL=chrome and a persistent profile.
 *
 * Env:
 *   BROWSER_CHANNEL=chrome          use installed Google Chrome instead of bundled Chromium
 *   BROWSER_PROFILE_DIR=.profile    keep cookies between runs (fewer CAPTCHAs)
 *   HEADLESS=false                  watch it work
 *   DEBUG_DIR=debug                 save a screenshot + page text for every property
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { parsePrice, sleep, withRetry, normalizeName } from '../util.js';

const KNOWN_SOURCES = [
  'MakeMyTrip', 'Goibibo', 'Agoda', 'Booking.com', 'Expedia', 'Hotels.com', 'Trip.com', 'Cleartrip',
  'Traveloka', 'Vio.com', 'Vio', 'EaseMyTrip', 'Yatra', 'Ixigo', 'HappyEasyGo', 'Priceline', 'Trivago',
  'Hostelworld', 'Travelocity', 'Orbitz', 'ZenHotels', 'Hotel.de', 'Ostrovok', 'Super.com', 'Tripadvisor',
  'Despegar', 'eDreams', 'Opodo', 'lastminute.com', 'Prestigia', 'Stayforlong', 'Algotels', 'FindHotel',
  'Bluepillow', 'Hurb', 'Kayak', 'Reservations.com', 'Airbnb', 'OYO', 'Treebo', 'FabHotels', 'Saltstayz.com', 'Saltstayz',
];
const SOURCE_RE = new RegExp('^(' + KNOWN_SOURCES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
const PRICE_RE = /₹\s?\d[\d,]*/;

let browser = null;
let context = null;

async function launch(settings) {
  const headless = process.env.HEADLESS !== 'false';
  const profileDir = process.env.BROWSER_PROFILE_DIR;
  const opts = {
    headless,
    channel: process.env.BROWSER_CHANNEL || undefined,
    args: ['--disable-blink-features=AutomationControlled', '--lang=en-IN'],
  };
  const ctxOpts = {
    locale: 'en-IN',
    timezoneId: settings.timezone || 'Asia/Kolkata',
    viewport: { width: 1366, height: 900 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  };
  if (profileDir) {
    context = await chromium.launchPersistentContext(path.resolve(profileDir), { ...opts, ...ctxOpts });
  } else {
    browser = await chromium.launch(opts);
    context = await browser.newContext(ctxOpts);
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
}

/*
 * Google Hotels keeps the stay dates and the currency in a protobuf blob called `ts` in the URL.
 * Decoded, it looks like:
 *   f1: 1
 *   f3: { f1: { f3: {} }, f2: { f2: { f1: {y, m, d}, f2: {y, m, d}, f3: 1 }, f6: { f1: 1 } } }
 *   f5: { f1: { f7: "INR" }, f3: {} }
 * Building it ourselves means the page opens straight on the right dates in rupees.
 */
function varint(n) { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; }
function field(num, wire, payload) { return [...varint((num << 3) | wire), ...payload]; }
function msg(num, bytes) { return field(num, 2, [...varint(bytes.length), ...bytes]); }
function int(num, v) { return field(num, 0, varint(v)); }
function str(num, v) { return msg(num, [...Buffer.from(v, 'utf8')]); }
function dateMsg(num, iso) { const [y, m, d] = iso.split('-').map(Number); return msg(num, [...int(1, y), ...int(2, m), ...int(3, d)]); }

export function buildTs(checkIn, checkOut, currency = 'INR') {
  const stay = msg(2, [...dateMsg(1, checkIn), ...dateMsg(2, checkOut), ...int(3, 1)]);
  const f3 = msg(3, [...msg(1, msg(3, [])), ...msg(2, [...stay, ...msg(6, int(1, 1))])]);
  const f5 = msg(5, [...msg(1, str(7, currency)), ...msg(3, [])]);
  return Buffer.from([...int(1, 1), ...f3, ...f5]).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function baseParams(u, query, window, settings) {
  u.searchParams.set('q', query);
  u.searchParams.set('hl', 'en-IN');
  u.searchParams.set('gl', 'in');
  u.searchParams.set('curr', settings.currency || 'INR');
  u.searchParams.set('ts', buildTs(window.checkIn, window.checkOut, settings.currency || 'INR'));
  return u.toString();
}

function searchUrl(query, window, settings) {
  return baseParams(new URL('https://www.google.com/travel/search'), query, window, settings);
}

function entityUrl(token, query, window, settings) {
  return baseParams(new URL(`https://www.google.com/travel/hotels/entity/${token}/prices`), query, window, settings);
}

/** What the page looks like right now: url, headings, tabs, inputs, dialogs, travel links and visible text. */
async function diagnostics(page) {
  return page.evaluate(() => {
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const links = [...document.querySelectorAll('a[href]')]
      .filter((a) => /travel|entity/.test(a.getAttribute('href')))
      .slice(0, 80)
      .map((a) => `${clean(a.innerText || a.getAttribute('aria-label')).slice(0, 90)}  =>  ${a.getAttribute('href').slice(0, 160)}`);
    const roleLinks = [...document.querySelectorAll('[role="link"],[role="button"][jsname]')].slice(0, 40).map((d) => clean(d.getAttribute('aria-label') || d.innerText).slice(0, 90));
    const inputs = [...document.querySelectorAll('input')].map((i) => `${i.getAttribute('aria-label') || ''} | ${i.placeholder || ''} | ${i.value || ''}`);
    const dialogs = [...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].map((d) => clean(d.innerText).slice(0, 300));
    const headings = [...document.querySelectorAll('h1,h2')].slice(0, 12).map((h) => clean(h.innerText).slice(0, 90));
    const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => clean(t.innerText).slice(0, 40));
    return { url: location.href, title: document.title, headings, tabs, inputs, dialogs, links, roleLinks, text: document.body.innerText.slice(0, 7000) };
  }).catch((e) => ({ error: e.message }));
}

async function dump(page, property, window, label) {
  const dir = process.env.DEBUG_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${property.id}_${window.key}_${label}`);
  await page.screenshot({ path: base + '.png', fullPage: true }).catch(() => {});
  const diag = await diagnostics(page);
  fs.writeFileSync(base + '.txt', diag.text || '');
  fs.writeFileSync(base + '.diag.json', JSON.stringify(diag, null, 2));
  if (process.env.DEBUG_PRINT) console.log(`\n===== ${label}: ${property.name} =====\n` + JSON.stringify(diag, null, 2));
}

async function isBlocked(page) {
  const url = page.url();
  if (/\/sorry\//.test(url) || /consent\.google/.test(url)) return true;
  const txt = (await page.evaluate(() => document.body.innerText.slice(0, 2000)).catch(() => '')) || '';
  return /unusual traffic|detected unusual|not a robot|CAPTCHA/i.test(txt);
}

/** "2026-10-04" -> "4 Oct", the way Google prints it inside its date boxes ("Sun, 4 Oct"). */
function dayMonth(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
function inputShowsDate(value, iso) {
  return new RegExp('(^|\\D)' + dayMonth(iso).replace(' ', '\\s') + '(\\D|$)', 'i').test(value || '');
}

/** Google hides most OTAs behind a "View more options" button. */
async function expandAllOptions(page) {
  const more = page.getByText(/view more options/i).first();
  if (await more.count()) { await more.click({ timeout: 5000, force: true }).catch(() => {}); await sleep(1200); }
}

async function readDateInputs(page) {
  return page.evaluate(() => {
    const get = (l) => document.querySelector(`input[aria-label*="${l}" i]`)?.value || '';
    return { checkIn: get('Check-in'), checkOut: get('Check-out') };
  });
}

/** Open the hotel's own page when the search landed on a list of results. */
async function openEntity(page, property) {
  if (/\/travel\/hotels\/entity\//.test(page.url()) || /\/travel\/hotels\/[^?]+\/entity/.test(page.url())) return true;
  const wanted = [property.name, ...(property.aliases || [])].map(normalizeName);
  const links = page.locator('a[href*="/travel/hotels/entity/"], a[href*="/entity/"]');
  const n = await links.count();
  let best = null;
  for (let i = 0; i < Math.min(n, 30); i++) {
    const text = normalizeName((await links.nth(i).innerText().catch(() => '')) || (await links.nth(i).getAttribute('aria-label').catch(() => '')) || '');
    if (!text) continue;
    const score = wanted.reduce((s, w) => Math.max(s, text === w ? 100 : text.includes(w) || w.includes(text) ? 80 : w.split(' ').filter((t) => t.length > 2 && text.includes(t)).length * 12), 0);
    if (!best || score > best.score) best = { i, score, text };
  }
  if (!best || best.score < 40) return false;
  const href = await links.nth(best.i).getAttribute('href');
  if (href) {
    await page.goto(new URL(href, 'https://www.google.com').toString(), { waitUntil: 'domcontentloaded' });
  } else {
    await links.nth(best.i).click({ timeout: 10000, force: true });
    await page.waitForLoadState('domcontentloaded');
  }
  await sleep(1500);
  return true;
}

async function openPricesTab(page) {
  const tab = page.getByRole('tab', { name: /prices/i }).first();
  if (await tab.count()) {
    await tab.click({ timeout: 10000 }).catch(() => {});
    await sleep(1200);
    return;
  }
  const link = page.locator('a[aria-label*="Prices" i], a:has-text("Prices")').first();
  if (await link.count()) {
    await link.click({ timeout: 10000 }).catch(() => {});
    await sleep(1200);
  }
}

/**
 * Parse Google's page text into [{source, price, official}]. We read innerText rather than CSS
 * classes because Google's class names change constantly but the text order is stable:
 *   "Saltstayz.com" / "Official site" / "₹2,429" ... "MakeMyTrip" / "₹2,332".
 */
export function parsePricesFromText(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^official site$/i.test(lines[i])) continue; // badge line, not a provider
    const m = lines[i].match(SOURCE_RE);
    const isOfficial = /official site/i.test(lines[i]) || (lines[i + 1] && /official site/i.test(lines[i + 1]));
    let source = m ? m[1] : null;
    if (!source && /^[A-Za-z][A-Za-z0-9 .'-]{1,30}$/.test(lines[i]) && isOfficial) source = lines[i].trim();
    if (!source) continue;
    for (let j = i; j <= Math.min(i + 4, lines.length - 1); j++) {
      if (j > i && lines[j].match(SOURCE_RE)) break; // ran into the next provider
      const pm = lines[j].match(PRICE_RE);
      if (pm) {
        const price = parsePrice(pm[0]);
        if (price != null) out.push({ source, price, official: isOfficial || /saltstayz/i.test(source) });
        break;
      }
    }
  }
  // De-dupe exact repeats (the page often prints the featured price twice).
  const seen = new Set();
  return out.filter((p) => {
    const k = `${p.source.toLowerCase()}|${p.price}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function detectAvailability(text) {
  if (/sold out/i.test(text)) return 'sold_out';
  if (/no (rooms|availability) (available|found)|not available for (these|the selected) dates|no availability/i.test(text)) return 'no_rooms';
  return 'available';
}

export default {
  name: 'browser',
  async init(settings) { if (!context) await launch(settings); },
  async close() {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    context = null; browser = null;
  },

  async fetchPrices(property, window, settings) {
    const timeout = settings.crawl?.pageTimeoutMs || 45000;
    return withRetry(async () => {
      const page = await context.newPage();
      page.setDefaultTimeout(timeout);
      try {
        const url = property.googleToken ? entityUrl(property.googleToken, property.query, window, settings) : searchUrl(property.query, window, settings);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        await sleep(settings.crawl?.politeDelayMs || 1500);
        if (await isBlocked(page)) { await dump(page, property, window, 'blocked'); throw new Error('Google showed a CAPTCHA / unusual-traffic page. Run from a normal network or use PROVIDER=serpapi.'); }

        await dump(page, property, window, 'search');
        const opened = await openEntity(page, property);
        if (!opened) {
          await dump(page, property, window, 'notfound');
          return { availability: 'not_found', matchedName: null, prices: [], note: 'Could not find this hotel on Google Hotels.', pricesFor: null, token: null };
        }
        await openPricesTab(page);
        await expandAllOptions(page);
        const dates = await readDateInputs(page);
        await dump(page, property, window, 'prices');

        const text = await page.evaluate(() => document.body.innerText);
        const matchedName = (await page.locator('h1').first().innerText().catch(() => '')).trim() || null;
        const prices = parsePricesFromText(text);
        if (!prices.length && /\$\s?\d/.test(text) && !/₹/.test(text)) throw new Error('Google showed prices in a currency other than INR; the ts parameter was not applied.');
        let availability = detectAvailability(text);
        if (availability === 'available' && prices.length === 0) availability = 'no_rooms';

        let note = '';
        let pricesFor = null;
        if (dates.checkIn && !inputShowsDate(dates.checkIn, window.checkIn)) {
          pricesFor = dates.checkIn;
          note = `No rooms on the asked date on Google. Prices shown are for ${dates.checkIn}.`;
          availability = 'no_rooms';
        }
        const tokenMatch = page.url().match(/\/entity\/([^/?]+)/);
        return { availability, matchedName, prices, note, pricesFor, token: tokenMatch ? tokenMatch[1] : null };
      } catch (err) {
        await dump(page, property, window, 'error');
        throw err;
      } finally {
        await page.close().catch(() => {});
      }
    }, { retries: settings.crawl?.retries ?? 2, delayMs: settings.crawl?.retryDelayMs ?? 4000, label: property.name });
  },
};
