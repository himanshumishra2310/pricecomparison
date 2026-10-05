// Decides whether the GitHub crawl should run or step aside because the office Mac (an Indian
// connection that sees MakeMyTrip and Goibibo) has reported recently. Prints "skip=true" or "skip=false".
// Manual runs from the Actions tab always run. Only the 2-hourly schedule defers to the Mac.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function shouldSkip({ event, latest, now = Date.now(), freshHours = 3 }) {
  if (event !== 'schedule') return { skip: false, reason: 'manual run' };
  if (!latest) return { skip: false, reason: 'no previous run' };
  const ageH = (now - new Date(latest.generatedAt).getTime()) / 3600000;
  const fromIndia = latest.indianOtasVisible === true;
  if (fromIndia && ageH < freshHours) return { skip: true, reason: `the last run is ${ageH.toFixed(1)}h old and came from India (MakeMyTrip and Goibibo visible)` };
  return { skip: false, reason: fromIndia ? `the Indian run is ${ageH.toFixed(1)}h old, so GitHub covers for it` : 'the last run did not come from India' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let latest = null;
  try { latest = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'latest.json'), 'utf8')); } catch { /* first run */ }
  const settings = JSON.parse(fs.readFileSync(path.join(root, 'config', 'settings.json'), 'utf8'));
  const r = shouldSkip({ event: process.env.GITHUB_EVENT_NAME, latest, freshHours: settings.failover?.indianRunFreshHours ?? 3 });
  console.error(`Crawl on GitHub: ${r.skip ? 'skipping' : 'running'} because ${r.reason}.`);
  console.log(`skip=${r.skip}`);
}
