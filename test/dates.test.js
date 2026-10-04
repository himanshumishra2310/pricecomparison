import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWindows, todayIso, runId } from '../src/dates.js';
import { loadSettings } from '../src/util.js';

const settings = loadSettings();

test('windows are D0, D1, D2 in IST, one night each', () => {
  // 20:00 UTC on 4 Oct is 01:30 IST on 5 Oct, so "today" must be 5 Oct.
  const now = new Date('2026-10-04T20:00:00Z');
  assert.equal(todayIso('Asia/Kolkata', now), '2026-10-05');
  const w = buildWindows(settings, now);
  assert.deepEqual(w.map((x) => [x.key, x.checkIn, x.checkOut]), [
    ['D0', '2026-10-05', '2026-10-06'], ['D1', '2026-10-06', '2026-10-07'], ['D2', '2026-10-07', '2026-10-08'],
  ]);
  assert.equal(runId('Asia/Kolkata', now), '2026-10-05_0130');
});

test('month boundary', () => {
  const w = buildWindows(settings, new Date('2026-10-31T10:00:00Z'));
  assert.equal(w[2].checkIn, '2026-11-02');
});
