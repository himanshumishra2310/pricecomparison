import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, normalizeName } from '../src/util.js';
import { parsePricesFromText, buildTs, matchScore, pricesFromRows } from '../src/providers/browser.js';

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

test('parsePricesFromText reads only the hotel\'s own price list', () => {
  const text = `Saltstayz Premier - Galleria Market Road & Sector 27
OverviewPricesReviewsLocationAboutPhotos
Check-in
Check-out
2
Sponsored·Featured options
Booking.com
Free cancellation until 29 Oct · Free Wi-Fi
₹2,600
Visit site
Deluxe Room with City View
1 double bed · Free cancellation until 29 Oct
₹2,600
Visit site
Visit site for more options
Expedia.com
Free cancellation until 5 Oct · Free Wi-Fi
₹2,900
Visit site
All options
Saltstayz Premier - Galleria Market Road & Sector 27
 Official site
₹2,429
Visit site
MakeMyTrip
Free cancellation until 27 Oct
,
₹2,332
Visit site
Agoda
₹2,548 · Breakfast included
Visit site
BookMyBooking.com
₹7,400
Visit site
Sponsored·Similar hotels
Saltstayz Premier - Millenium City Centre
₹4,264
 Hotels.com
Visit Hotels.com
People also viewed
₹1,656
Townhouse by OYO Tipsyy Inn 16`;
  assert.deepEqual(parsePricesFromText(text), [
    { source: 'Booking.com', price: 2600, official: false },
    { source: 'Expedia', price: 2900, official: false },
    { source: 'Saltstayz.com', price: 2429, official: true },
    { source: 'MakeMyTrip', price: 2332, official: false },
    { source: 'Agoda', price: 2548, official: false },
    { source: 'BookMyBooking.com', price: 7400, official: false },
  ]);
  assert.deepEqual(parsePricesFromText('Nothing here\nAvailable for 6–7 Oct for ₹3,346.\nSponsored·Similar hotels\nX\n₹1\nVisit site'), []);
});

test('matchScore picks the right hotel from a results list', () => {
  const prop = { name: 'Saltstayz Select - Near Sohna Road City Center', aliases: ['Saltstayz Select Sohna Road'] };
  assert.equal(matchScore(prop, 'Saltstayz Select - Near Sohna Road City Center'), 100);
  assert.ok(matchScore(prop, 'Saltstayz Select') < 75, 'a different Saltstayz Select must not match');
  assert.ok(matchScore({ name: 'Saltstayz Premier - Near Golf Course Road & Sector 57', aliases: ['Saltstayz Premier'] }, 'Saltstayz Premier') === 100);
  assert.ok(matchScore(prop, 'Lemon Tree Hotel, Udyog Vihar Gurugram') < 40);
});

test('buildTs reproduces the ts blob Google itself generates', () => {
  // Captured from a real Google Hotels URL for 29-30 Oct 2026 in USD.
  assert.equal(buildTs('2026-10-29', '2026-10-30', 'USD'), 'CAEaIAoCGgASGhIUCgcI6g8QChgdEgcI6g8QChgeGAEyAggBKgkKBToDVVNEGgA');
  assert.match(buildTs('2026-10-04', '2026-10-05', 'INR'), /^[A-Za-z0-9_-]+$/);
});

test('pricesFromRows uses logo alt text when the provider name is not in the text', () => {
  const rows = [
    { text: 'Saltstayz Premier - Cyber Hub\n Official site\n₹3,509\nVisit site', names: [], official: true },
    { text: 'Agoda\n₹3,346\nVisit site', names: [], official: false },
    { text: 'Free cancellation until 5 Oct\n,\n₹3,100\nVisit site', names: ['MakeMyTrip'], official: false },
    { text: 'Free cancellation until 5 Oct\n,\n₹3,050\nVisit site', names: ['Goibibo logo'], official: false },
    { text: 'Deluxe Room with Balcony\n1 double bed\n₹4,072\nVisit site', names: [], official: false },
    { text: 'Agoda₹3,225 with taxes + feesNightly base price', names: [], official: false, tooltip: true },
    { text: 'Traveloka\n₹9,999\nVisit site', names: [], official: false, hidden: true },
  ];
  assert.deepEqual(pricesFromRows(rows), [
    { source: 'Saltstayz.com', price: 3509, official: true },
    { source: 'Agoda', price: 3346, official: false },
    { source: 'MakeMyTrip', price: 3100, official: false },
    { source: 'Goibibo', price: 3050, official: false },
  ]);
});
