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
  assert.deepEqual(r.lowest, { source: 'MakeMyTrip', price: 2332 });
});

test('Saltstayz lowest when every OTA is dearer or equal', () => {
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: S, price: 2545 }, { source: 'Agoda', price: 2548 }, { source: 'Booking.com', price: 2545 }] }, settings);
  assert.equal(r.status, 'direct_lowest');
  assert.equal(r.deviations.length, 0);
  assert.equal(r.otas.agoda, 2548);
  assert.equal(r.otas.booking, 2545);
});

test('untracked OTA (Cleartrip) still counts as a deviation and shows under "also cheaper"', () => {
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: S, price: 2308 }, { source: 'Agoda', price: 2304 }, { source: 'Cleartrip', price: 2220 }] }, settings);
  assert.equal(r.status, 'ota_lower');
  assert.deepEqual(r.deviations.map((d) => d.source), ['Cleartrip', 'Agoda']);
  assert.deepEqual(r.others, [{ source: 'Cleartrip', price: 2220 }]);
  assert.equal(r.lowest.source, 'Cleartrip');
});

test('untracked OTAs are ignored when anyOtaCountsAsDeviation is false', () => {
  const s = { ...settings, deviation: { ...settings.deviation, anyOtaCountsAsDeviation: false } };
  const r = compareProperty(prop, { availability: 'available', prices: [{ source: S, price: 2308 }, { source: 'Cleartrip', price: 2220 }] }, s);
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
