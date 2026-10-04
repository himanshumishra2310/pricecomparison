/**
 * Crawl a single property in the browser with debug output, so the Google page
 * structure can be checked quickly. Usage:
 *   HEADLESS=false DEBUG_DIR=debug node src/debug-crawl.js "Cyber Hub" [D0|D1|D2]
 */
import { loadProperties, loadSettings } from './util.js';
import { buildWindows } from './dates.js';
import { getProvider } from './providers/index.js';

const needle = (process.argv[2] || '').toLowerCase();
const winKey = process.argv[3] || 'D0';
const settings = loadSettings();
const property = loadProperties().find((p) => p.name.toLowerCase().includes(needle) || p.id.includes(needle));
if (!property) { console.error('No property matches', needle); process.exit(1); }
const window = buildWindows(settings).find((w) => w.key === winKey);
process.env.DEBUG_DIR ||= 'debug';
const provider = await getProvider(process.env.PROVIDER || 'browser');
await provider.init(settings);
try {
  console.log(`Crawling ${property.name} for ${window.checkIn} → ${window.checkOut} with ${provider.name}`);
  const result = await provider.fetchPrices(property, window, settings);
  console.log(JSON.stringify(result, null, 2));
  console.log(`Screenshots and page text saved under ${process.env.DEBUG_DIR}/`);
} finally {
  await provider.close();
}
