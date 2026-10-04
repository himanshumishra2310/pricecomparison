import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

export function loadSettings() {
  return readJson(path.join(ROOT, 'config', 'settings.json'));
}

export function loadProperties() {
  return readJson(path.join(ROOT, 'config', 'properties.json')).properties;
}

/** Lowercase, strip punctuation, collapse spaces. Used for fuzzy name matching. */
export function normalizeName(s = '') {
  return String(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "₹2,548" / "INR 2548" / "2,548" -> 2548. Returns null when nothing numeric is found. */
export function parsePrice(text) {
  if (text == null) return null;
  if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text) : null;
  const m = String(text).replace(/[ \s]/g, '').match(/(\d[\d,]*)(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

export function formatInr(n) {
  if (n == null) return '—';
  return '₹' + Number(n).toLocaleString('en-IN');
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run `fn(item)` over items with limited parallelism, preserving order. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

export async function withRetry(fn, { retries = 2, delayMs = 3000, label = '' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        console.warn(`  retry ${attempt + 1}/${retries} ${label}: ${err.message}`);
        await sleep(delayMs * (attempt + 1));
      }
    }
  }
  throw lastErr;
}
