import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePrice, normalizeName } from '../src/util.js';
import { parsePricesFromText, buildTs, matchScore, pricesFromRows, attachAllIn, pickPrice } from '../src/providers/browser.js';
const bare = (a) => a.map(({ source, price, official }) => ({ source, price, official }));

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
  assert.deepEqual(bare(parsePricesFromText(text)), [
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
  // A generic two-word listing must not be accepted for a specific property via a short alias.
  assert.ok(matchScore({ name: 'Saltstayz Select - Golf Course Road & Sector 57', aliases: ['Saltstayz Select Sector 57'] }, 'Saltstayz Select') < 75);
  // ...but when Google really lists the hotel under that short name, the exact alias is accepted (Select Sector 57).
  assert.equal(matchScore({ name: 'Saltstayz Select - Golf Course Road & Sector 57', aliases: ['Saltstayz Select'] }, 'Saltstayz Select'), 100);
  // The five hotels Google lists under different names.
  assert.ok(matchScore({ name: 'Saltstayz Premier - Noida, Near Sector 18 Metro', aliases: ['Saltstayz Premier- Sector 26 Noida'] }, 'Saltstayz Premier- Sector 26 Noida') === 100);
  assert.ok(matchScore({ name: 'Saltstayz Premier Near Sector 44 Corporate Hub', aliases: ['Saltstayz Residences Sector 45'] }, 'Saltstayz Residences Sector 45') === 100);
  assert.ok(matchScore({ name: 'Saltstayz Select - Malcha & Chanakyapuri', aliases: ['Saltstayz Select - Malcha & Chankyapuri'] }, 'Saltstayz Select - Malcha & Chankyapuri') === 100);
  assert.ok(matchScore({ name: 'Saltstayz Select - Near Sohna Road City Center', aliases: ['Saltstayz'] }, 'Saltstayz') === 100);
  assert.ok(matchScore({ name: 'Saltstayz Select - Near Sohna Road City Center', aliases: ['Saltstayz'] }, 'Saltstayz Premier') < 75);
  assert.ok(matchScore({ name: 'Saltstayz Premier - Pitampura', aliases: [] }, 'Pitampura') < 75);
  assert.ok(matchScore({ name: 'Saltstayz Premier - Pitampura', aliases: [] }, 'Saltstayz Premier - Pitampura · 125 results'.replace(/\s*·.*$/, '')) === 100);
  assert.ok(matchScore(prop, 'Lemon Tree Hotel, Udyog Vihar Gurugram') < 40);
  // Different sector numbers are different hotels even when every other word matches.
  assert.ok(matchScore({ name: 'Saltstayz Select - Golf Course Road & Sector 57', aliases: [] }, 'Saltstayz Select Sector 27 - Golf Course Road') <= 50);
  assert.ok(matchScore({ name: 'Saltstayz Select - Golf Course Road & Sector 27', aliases: [] }, 'Saltstayz Select Sector 27 - Golf Course Road') >= 75);
  assert.ok(matchScore({ name: 'Saltstayz Premier - Golf Course Road & Sector 42', aliases: [] }, 'Saltstayz Gurgaon - Golf Course Road & Sector 42') >= 75);
  assert.ok(matchScore({ name: 'Saltstayz Premier - Golf Course Road & Sector 42', aliases: [] }, 'Saltstayz Premier - Golf Course Extension Road') < 75);
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
  assert.deepEqual(bare(pricesFromRows(rows)), [
    { source: 'Saltstayz.com', price: 3509, official: true },
    { source: 'Agoda', price: 3346, official: false },
    { source: 'MakeMyTrip', price: 3100, official: false },
    { source: 'Goibibo', price: 3050, official: false },
  ]);
});

test('attachAllIn pairs the hover "with taxes + fees" price with the right platform', () => {
  const prices = [
    { source: 'Saltstayz.com', price: 3283, official: true },
    { source: 'Agoda', price: 3018, official: false },
    { source: 'ixigo', price: 2990, official: false },
    { source: 'Booking.com', price: 3879, official: false },
  ];
  const rows = [
    { text: 'Saltstayz Premier - Galleria Market Road & Sector 27 |  |  Official site₹3,447 with taxes + feesNightly base priceNightly price with taxes + feesStay total with taxes + fees₹3,283₹3,283₹3,447₹3,447', official: true, tooltip: true },
    { text: 'Agoda₹3,225 with taxes + feesNightly base priceNightly price with taxes + feesStay total with taxes + fees₹3,018₹3,018₹3,225₹3,225Visit site', official: false, tooltip: true },
    { text: 'ixigo₹3,310 with taxes + feesNightly base price₹2,990₹2,990₹3,310₹3,310', official: false, tooltip: true },
  ];
  const out = attachAllIn(prices, rows);
  assert.equal(out.find((p) => p.official).allIn, 3447);
  assert.equal(out.find((p) => p.source === 'Agoda').allIn, 3225);
  assert.equal(out.find((p) => p.source === 'ixigo').allIn, 3310);
  assert.equal(out.find((p) => p.source === 'Booking.com').allIn, undefined);
});

test('an alias with a different sector number still matches when it is exactly the Google name', () => {
  const prop = { name: 'Saltstayz Premier Near Sector 44 Corporate Hub', aliases: ['Saltstayz Residences Sector 45', 'Saltstayz Premier Sector 44'] };
  assert.equal(matchScore(prop, 'Saltstayz Residences Sector 45'), 100);
  assert.ok(matchScore(prop, 'Saltstayz Premier - Sector 50') < 75);
  assert.ok(matchScore({ name: 'Saltstayz Select - Golf Course Road & Sector 57', aliases: [] }, 'Saltstayz Select Sector 27 - Golf Course Road') <= 50);
});

test('a crossed-out original price never wins over the real price (Hebbal member rate)', () => {
  // original price first, real price last
  assert.equal(pickPrice(['Saltstayz Premier', 'Official site', 'Member rate; save 62%', ',', '₹9,735', '₹3,654']), 3654);
  // real price first, crossed-out price second (Cleartrip deal layout)
  assert.equal(pickPrice(['Cleartrip.com', 'DEAL', '5% off', 'Free cancellation until Oct 5', '₹1,823', '₹1,920']), 1823);
  // no discount marker: first price, as before
  assert.equal(pickPrice(['Agoda', '₹3,018', '₹3,225']), 3018);
  assert.equal(pickPrice(['Agoda', 'Free Wi-Fi', '₹2,548 · Breakfast included']), 2548);
  assert.equal(pickPrice(['Agoda', 'Free Wi-Fi']), null);
  const text = `Saltstayz Premier Bengaluru, Hebbal
Sponsored·Featured options
All options
Saltstayz Premier Bengaluru, Hebbal, Airport Road
 Official site
Member rate; save 62%
,
₹9,735
₹3,654
Visit site
Agoda
Free Wi-Fi
₹3,761
Visit site
Bluepillow.in
Member rate; save 19%
₹11,779
₹9,514
Visit site
Sponsored·Similar hotels
X`;
  const got = parsePricesFromText(text).map(({ source, price }) => [source, price]);
  assert.deepEqual(got, [['Saltstayz.com', 3654], ['Agoda', 3761], ['Bluepillow', 9514]]);
});
