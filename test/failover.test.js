import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldSkip } from '../scripts/should-run.js';

const now = Date.parse('2026-10-05T12:00:00Z');
const ago = (h) => new Date(now - h * 3600000).toISOString();

test('GitHub steps aside when the Mac reported from India within 3 hours', () => {
  assert.equal(shouldSkip({ event: 'schedule', latest: { generatedAt: ago(1.5), indianOtasVisible: true }, now }).skip, true);
});
test('GitHub covers when the Mac is overdue', () => {
  assert.equal(shouldSkip({ event: 'schedule', latest: { generatedAt: ago(3.5), indianOtasVisible: true }, now }).skip, false);
});
test('GitHub runs when the last run was not from India, or there is none', () => {
  assert.equal(shouldSkip({ event: 'schedule', latest: { generatedAt: ago(0.5), indianOtasVisible: false }, now }).skip, false);
  assert.equal(shouldSkip({ event: 'schedule', latest: null, now }).skip, false);
});
test('manual runs always run', () => {
  assert.equal(shouldSkip({ event: 'workflow_dispatch', latest: { generatedAt: ago(0.1), indianOtasVisible: true }, now }).skip, false);
});
