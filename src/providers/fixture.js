/**
 * Fixture provider: replays saved data so the compare/report/notify pipeline can be
 * tested without touching Google. Uses test/fixtures/prices.json.
 */
import path from 'node:path';
import { ROOT, readJson } from '../util.js';

const fixture = readJson(path.join(ROOT, 'test', 'fixtures', 'prices.json'));

export default {
  name: 'fixture',
  async init() {},
  async close() {},
  async fetchPrices(property, window) {
    const byWindow = fixture[property.id] || {};
    const raw = byWindow[window.key] || byWindow.default;
    if (!raw) return { availability: 'not_found', matchedName: null, prices: [], note: '', pricesFor: null, token: null };
    return { availability: 'available', matchedName: property.name, prices: [], note: '', pricesFor: null, token: null, ...raw };
  },
};
