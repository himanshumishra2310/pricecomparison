// Quick test used by setup-mac.sh: crawl a few hotels and report whether Google lists MakeMyTrip / Goibibo
// for this connection. Exit code 0 = yes, 3 = no.
import { loadProperties, loadSettings } from '../src/util.js';
import { buildWindows } from '../src/dates.js';
import { getProvider } from '../src/providers/index.js';

const settings = loadSettings();
const window = buildWindows(settings).find((w) => w.key === 'D1');
const wanted = ['premier-galleria-sector-27', 'premier-sector-50-golf-course-ext-road', 'premier-medicity', 'premier-naraina', 'premier-millenium-city-centre'];
const props = loadProperties().filter((p) => wanted.includes(p.id));
const provider = await getProvider('browser');
await provider.init(settings);
let seen = new Set(), total = 0;
try {
  for (const p of props) {
    const r = await provider.fetchPrices(p, window, settings).catch((e) => ({ prices: [], note: e.message }));
    const sources = (r.prices || []).map((x) => x.source);
    total += sources.length;
    for (const s of sources) if (/makemytrip|goibibo/i.test(s)) seen.add(s);
    console.log(`  ${p.name}: ${sources.length} prices from ${[...new Set(sources)].join(', ') || 'none'}${r.note ? ` (${r.note})` : ''}`);
  }
} finally { await provider.close(); }
console.log(seen.size ? `RESULT: MakeMyTrip/Goibibo visible (${[...seen].join(', ')})` : `RESULT: not visible (${total} prices read in total)`);
process.exit(seen.size ? 0 : 3);
