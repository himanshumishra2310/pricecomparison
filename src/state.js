/**
 * Remembers which deviations were open at the last run so alerts can say
 * "new since last check" vs "still open" vs "resolved".
 */
import path from 'node:path';
import { ROOT, readJson, writeJson } from './util.js';

const FILE = path.join(ROOT, 'data', 'state.json');

export function loadState() {
  return readJson(FILE, { lastRunId: null, openDeviations: {}, tokens: {} });
}

export function saveState(state) {
  writeJson(FILE, state);
}

export function deviationKey(windowKey, row, dev) {
  return `${row.id}|${windowKey}|${dev.source}`;
}

/** Diff this run's deviations against the previous run's. */
export function diffDeviations(prevOpen, windows) {
  const current = {};
  for (const w of windows) {
    for (const row of w.rows) {
      for (const dev of row.deviations) {
        current[deviationKey(w.key, row, dev)] = {
          propertyId: row.id, property: row.name, window: w.key, windowLabel: w.label,
          source: dev.source, otaPrice: dev.price, direct: row.direct, gapRupees: dev.gapRupees,
          gapPercent: dev.gapPercent, kind: dev.kind,
        };
      }
    }
  }
  const added = Object.keys(current).filter((k) => !prevOpen[k]).map((k) => current[k]);
  const ongoing = Object.keys(current).filter((k) => prevOpen[k]).map((k) => current[k]);
  const resolved = Object.keys(prevOpen).filter((k) => !current[k]).map((k) => prevOpen[k]);
  return { current, added, ongoing, resolved };
}
