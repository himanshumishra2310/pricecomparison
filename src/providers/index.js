/**
 * A provider fetches Google Hotels prices for one property and one date window.
 *
 *   fetchPrices(property, window, settings) -> {
 *     availability: 'available' | 'not_found' | 'sold_out' | 'no_rooms' | 'error',
 *     matchedName: string|null,     // the hotel name Google listed
 *     prices: [{ source, price, official }],
 *     note: string,                 // shown on the dashboard under the property
 *     pricesFor: 'YYYY-MM-DD'|null, // when Google shows prices for a different date than asked
 *     token: string|null            // Google/SerpApi property token to cache for next time
 *   }
 *
 * PROVIDER env var picks one: fixture (test data), serpapi (paid API, most reliable), browser (free, Chromium crawl).
 */
export async function getProvider(name = process.env.PROVIDER || 'browser') {
  switch (name) {
    case 'fixture': return (await import('./fixture.js')).default;
    case 'serpapi': return (await import('./serpapi.js')).default;
    case 'browser': return (await import('./browser.js')).default;
    default: throw new Error(`Unknown PROVIDER "${name}". Use fixture, serpapi or browser.`);
  }
}
