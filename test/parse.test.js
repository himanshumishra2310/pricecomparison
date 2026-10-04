import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, normalizeName } from '../src/util.js';
import { parsePricesFromText, buildTs } from '../src/providers/browser.js';

test('parsePrice handles rupee formats', () => {
  assert.equal(parsePrice('₹2,548'), 2548);
  assert.equal(parsePrice('₹ 10,361'), 10361);
  assert.equal(parsePrice('INR 2548.00'), 2548);
  assert.equal(parsePrice(2304.4), 2304);
  assert.equal(parsePrice('—'), null);
});

test('normalizeName', () => {
  assert.equal(normalizeName('Saltstayz Premier - Golf Course Road & Sector 42'), 'saltstayz premier golf course road and sector 42');
});

test('parsePricesFromText reads the Google Hotels prices tab text', () => {
  const text = `Saltstayz Premier - Galleria Market Road & Sector 27
Overview
Prices
Reviews
Saltstayz.com
Official site
₹2,429
Free cancellation
MakeMyTrip
₹2,332
Agoda
₹2,548 · Breakfast included
Booking.com
Not available
Cleartrip
₹2,220
Hotel Something Else
₹9,999`;
  const prices = parsePricesFromText(text);
  assert.deepEqual(prices, [
    { source: 'Saltstayz.com', price: 2429, official: true },
    { source: 'MakeMyTrip', price: 2332, official: false },
    { source: 'Agoda', price: 2548, official: false },
    { source: 'Cleartrip', price: 2220, official: false },
  ]);
});

test('buildTs reproduces the ts blob Google itself generates', () => {
  // Captured from a real Google Hotels URL for 29-30 Oct 2026 in USD.
  assert.equal(buildTs('2026-10-29', '2026-10-30', 'USD'), 'CAEaIAoCGgASGhIUCgcI6g8QChgdEgcI6g8QChgeGAEyAggBKgkKBToDVVNEGgA');
  assert.match(buildTs('2026-10-04', '2026-10-05', 'INR'), /^[A-Za-z0-9_-]+$/);
});
