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

/** Google hides most OTAs behind a "View more options from ₹X" button. Click it (in-page, so overlays cannot block) until it is gone. */
async function expandAllOptions(page) {
  for (let i = 0; i < 4; i++) {
    const clicked = await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!/view more options/i.test(node.nodeValue || '')) continue;
        let el = node.parentElement;
        const target = el.closest('button, [role="button"], a, [jsaction]') || el;
        target.scrollIntoView({ block: 'center' });
        target.click();
        return true;
      }
      return false;
    }).catch(() => false);
    if (!clicked) return;
    await sleep(1800);
  }
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
        let opened = false;
        if (property.googleToken) {
          await page.goto(entityUrl(property.googleToken, property.query, window, settings), { waitUntil: 'domcontentloaded', timeout });
          await sleep(settings.crawl?.politeDelayMs || 1500);
          if (await isBlocked(page)) { await dump(page, property, window, 'blocked'); throw new Error('Google showed a CAPTCHA / unusual-traffic page. Run from a normal network or use PROVIDER=serpapi.'); }
          opened = /\/travel\/hotels\/entity\//.test(page.url());
        }
        // Try the configured search first, then the aliases, then "<brand> <city>" and pick the hotel from the list.
        const brand = property.name.split(/[-,(]/)[0].trim();
        const queries = [...new Set([property.query, ...(property.aliases || []), `${brand} ${property.city || ''}`.trim()].filter(Boolean))];
        for (const q of queries) {
          if (opened) break;
          await page.goto(searchUrl(q, window, settings), { waitUntil: 'domcontentloaded', timeout });
          await sleep(settings.crawl?.politeDelayMs || 1500);
          if (await isBlocked(page)) { await dump(page, property, window, 'blocked'); throw new Error('Google showed a CAPTCHA / unusual-traffic page. Run from a normal network or use PROVIDER=serpapi.'); }
          await dump(page, property, window, 'search');
          opened = await openEntity(page, property);
        }
        if (!opened) {
          await dump(page, property, window, 'notfound');
          return { availability: 'not_found', matchedName: null, prices: [], note: 'Could not find this hotel on Google Hotels.', pricesFor: null, token: null };
        }
        await openPricesTab(page);
        await expandAllOptions(page);
        const dates = await readDateInputs(page);
        await dump(page, property, window, 'prices');

        const text = await page.evaluate(() => document.body.innerText);
        const matchedName = (await page.locator('h1').first().innerText().catch(() => '')).replace(/\s*·\s*[\d,.]+K?\s*results?$/i, '').trim() || null;
        const prices = parsePricesFromText(text, settings.directChannel?.label || 'Saltstayz.com');
        if (!prices.length && /\$\s?\d/.test(text) && !/₹/.test(text)) throw new Error('Google showed prices in a currency other than INR; the ts parameter was not applied.');
        let availability = detectAvailability(text);
        let note = '';
        let pricesFor = null;
        const next = nextAvailable(text);
        if (dates.checkIn && !inputShowsDate(dates.checkIn, window.checkIn)) {
          pricesFor = dates.checkIn;
          note = `No rooms on the asked date on Google. Prices shown are for ${dates.checkIn}.`;
          availability = 'no_rooms';
        } else if (prices.length === 0 && next) {
          pricesFor = next;
          note = `No rooms on the asked date on Google. Next date Google offers is ${next}.`;
          availability = 'no_rooms';
        } else if (availability === 'available' && prices.length === 0) {
          availability = 'no_prices';
          note = 'Google shows no Saltstayz.com or OTA price for this date.';
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
