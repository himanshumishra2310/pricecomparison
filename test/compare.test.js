import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProperty, summarize, sortRows } from '../src/compare.js';
import { loadSettings } from '../src/util.js';

const settings = loadSettings();
const prop = { id: 'x', name: 'Saltstayz Premier - Test', aliases: [] };
const S = 'Saltstayz.com';

test('OTA lower than Saltstayz.com is a deviation', () => {
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: S, price: 2429, official: true }, { source: 'MakeMyTrip', price: 2332 }] }, settings);
  assert.equal(r.status, 'ota_lower');
  assert.equal(r.deviations.length, 1);
  assert.equal(r.deviations[0].source, 'MakeMyTrip');
  assert.equal(r.deviations[0].gapRupees, 97);
  assert.equal(r.deviations[0].gapPercent, 4);
  assert.equal(r.lowest.source, 'MakeMyTrip');
  assert.equal(r.lowest.price, 2332);
});

test('Saltstayz lowest when every OTA is dearer or equal', () => {
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: S, price: 2545 }, { source: 'Agoda', price: 2548 }, { source: 'Booking.com', price: 2545 }] }, settings);
  assert.equal(r.status, 'direct_lowest');
  assert.equal(r.deviations.length, 0);
  assert.equal(r.otas.agoda, 2548);
  assert.equal(r.otas.booking, 2545);
});

test('untracked OTA (Traveloka) still counts as a deviation and shows under "also cheaper"', () => {
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: S, price: 2308 }, { source: 'Agoda', price: 2304 }, { source: 'Traveloka', price: 2220 }] }, settings);
  assert.equal(r.status, 'ota_lower');
  assert.deepEqual(r.deviations.map((d) => d.source), ['Traveloka', 'Agoda']);
  assert.deepEqual(r.others, [{ source: 'Traveloka', price: 2220 }]);
  assert.equal(r.lowest.source, 'Traveloka');
});

test('untracked OTAs are ignored when anyOtaCountsAsDeviation is false', () => {
  const s = { ...settings, deviation: { ...settings.deviation, anyOtaCountsAsDeviation: false } };
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: S, price: 2308 }, { source: 'Traveloka', price: 2220 }] }, s);
  assert.equal(r.status, 'direct_lowest');
});

test('missing Saltstayz.com price while OTAs sell is flagged', () => {
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: 'MakeMyTrip', price: 2713 }, { source: 'Agoda', price: 3590 }] }, settings);
  assert.equal(r.status, 'direct_missing');
  assert.equal(r.deviations[0].kind, 'direct_missing');
  assert.equal(r.lowest.source, 'MakeMyTrip');
});

test('sold out / no rooms / not found never raise deviations', () => {
  for (const availability of ['sold_out', 'no_rooms', 'not_found']) {
    const r = compareProperty(prop, { availability, prices: [{ source: 'EaseMyTrip', price: 2650 }] }, settings);
    assert.equal(r.deviations.length, 0, availability);
  }
  assert.equal(compareProperty(prop, undefined, settings).status, 'error');
});

test('minimum gap thresholds suppress tiny differences', () => {
  const s = { ...settings, deviation: { ...settings.deviation, minGapRupees: 10 } };
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: S, price: 3659 }, { source: 'MakeMyTrip', price: 3653 }] }, s);
  assert.equal(r.status, 'direct_lowest');
});

test('summary and sort', () => {
  const rows = [
    compareProperty({ ...prop, id: 'a', name: 'A' }, { availability: 'available', prices: [{ source: S, price: 2000 }, { source: 'Agoda', price: 1800 }] }, settings),
    compareProperty({ ...prop, id: 'b', name: 'B' }, { availability: 'available', prices: [{ source: S, price: 2000 }, { source: 'Agoda', price: 2200 }] }, settings),
    compareProperty({ ...prop, id: 'c', name: 'C' }, { availability: 'not_found', prices: [] }, settings),
  ];
  const s = summarize(rows, settings);
  assert.equal(s.comparable, 2);
  assert.equal(s.pctDirectLowest, 50);
  assert.equal(s.avgGapWhereOtaLowest, -10);
  assert.equal(s.avgGapWhereDirectLowest, 10);
  assert.equal(s.avgGapNearestOta, 0);
  assert.deepEqual(sortRows(rows).map((r) => r.id), ['a', 'b', 'c']);
});

test('priceBasis all_in compares the with-taxes prices, but only when every price has one', () => {
  const s = { ...settings, priceBasis: 'all_in' };
  const full = compareProperty(prop, { availability: 'available', prices: [
    { source: S, price: 3283, allIn: 3447, official: true, raw: 'direct row' },
    { source: 'ixigo', price: 3100, allIn: 3560, raw: 'ixigo row' },
    { source: 'Agoda', price: 3200, allIn: 3300, raw: 'agoda row' },
  ] }, s);
  assert.equal(full.basis, 'all_in');
  assert.equal(full.direct, 3447);
  assert.equal(full.lowest.source, 'Agoda');          // ixigo is only cheaper before taxes
  assert.equal(full.deviations.length, 1);
  assert.equal(full.lowest.raw, 'agoda row');
  const partial = compareProperty(prop, { availability: 'available', prices: [
    { source: S, price: 3283, allIn: 3447, official: true },
    { source: 'ixigo', price: 3100 },
  ] }, s);
  assert.equal(partial.basis, 'listed');
  assert.equal(partial.direct, 3283);
  assert.equal(partial.lowest.source, 'ixigo');
});

test('default basis is the listed price', () => {
  const r = compareProperty(prop, { availability: 'available', prices: [
    { source: S, price: 3283, allIn: 3447, official: true }, { source: 'ixigo', price: 3100, allIn: 3560 } ] }, settings);
  assert.equal(r.basis, 'listed');
  assert.equal(r.lowest.source, 'ixigo');
  assert.equal(r.otaRaw.ixigo.allIn, 3560);
});

test('a member-rate direct price: public price compared, member rate mentioned in the note', () => {
  const r = compareProperty(prop, { availability: 'available', prices: [
    { source: S, price: 8450, member: 3576, official: true, raw: 'Official site | Member rate; save 58% | , | ₹8,450 | ₹3,576' },
    { source: 'Agoda', price: 3532, raw: 'Agoda | ₹3,532' } ] }, settings);
  assert.equal(r.direct, 8450);
  assert.match(r.note, /member rate of ₹3,576 \(save 58%\)/);
  assert.equal(r.status, 'ota_lower');
});
