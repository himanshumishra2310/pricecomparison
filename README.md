# Saltstayz Rate Parity Checker

Crawls Google Hotels for all 33 live Saltstayz properties, compares the **Saltstayz.com** price with
the OTA prices Google lists (MakeMyTrip, Goibibo, Agoda, Booking.com, plus any other OTA that shows
up), records every run, renders a dashboard, and sends an alert whenever an OTA is cheaper than
Saltstayz.com.

It runs **every 2 hours** and checks three stays each time, all 1 night, 2 adults, incl. taxes:

| Window | Check-in | Check-out |
|---|---|---|
| D0 | today | tomorrow |
| D1 | tomorrow | day after |
| D2 | day after | day after that |

"Today" is always the Indian calendar day (Asia/Kolkata).

## What counts as a deviation

* Any OTA price on Google that is **lower than the Saltstayz.com price** for the same stay. This includes
  OTAs that are not in the four main columns (Cleartrip, Traveloka, Vio, EaseMyTrip, ...). They are shown
  under the property as "Also cheaper: ...". Turn this off with `anyOtaCountsAsDeviation: false` in
  `config/settings.json` if you only want the four main OTAs to count.
* **Saltstayz.com price missing** on Google while OTAs are selling the property. This is flagged separately.
* Sold out, no rooms, or not listed on Google are shown but never raise an alert.
* `minGapRupees` / `minGapPercent` in `config/settings.json` let you ignore tiny differences (default 0 = flag everything).

## How it works

```
config/properties.json   the 33 properties and what to search on Google
config/settings.json     OTAs, date windows, alert rules, crawl speed
src/run.js               one full run: crawl -> compare -> save -> dashboard -> notify
src/providers/           where prices come from: browser (Chromium), serpapi (API), fixture (test data)
src/compare.js           deviation rules and summary numbers
src/report.js            the dashboard page (docs/index.html)
src/notify/              email (SMTP) and WhatsApp (Meta Cloud API or Twilio)
data/runs/<date>/<time>.json   every run, kept forever
data/state.json          which deviations were open last run (so alerts can say "new" / "resolved")
docs/index.html          the dashboard, served by GitHub Pages
docs/latest.json         the latest run as data
docs/history.json        one line per run with the summary numbers
```

## Running it

```bash
npm install
cp .env.example .env      # fill in alert details, see below

npm run run:fixture       # replay sample data, no network. Good for checking the dashboard.
npm run run:browser       # crawl Google Hotels in Chromium (free)
npm run run:serpapi       # crawl via SerpApi (needs SERPAPI_KEY, paid, most reliable)
npm run serve             # open the dashboard locally
npm test
```

`DRY_RUN=1` runs everything but sends no alerts and does not update the alert state.

### Checking one property in the browser

```bash
HEADLESS=false DEBUG_DIR=debug node src/debug-crawl.js "Cyber Hub" D0
```

This opens a visible Chromium, prints what it found, and saves a screenshot and the page text under
`debug/`. Use this first on your Mac to confirm Google's page still looks the way the crawler expects.

## Picking a data source

| Provider | Cost | Reliability | Notes |
|---|---|---|---|
| `browser` | free | medium | Google can show a CAPTCHA to cloud IPs (GitHub Actions). Works best from a normal machine. `BROWSER_CHANNEL=chrome` and `BROWSER_PROFILE_DIR=.profile` reduce CAPTCHAs. |
| `serpapi` | paid | high | 99 searches per run (33 x 3 windows), ~1,200/day, ~36,000/month at 2-hourly. Check SerpApi pricing before enabling. |
| `fixture` | free | n/a | Replays `test/fixtures/prices.json`. For tests and dashboard previews only. |

The scheduled GitHub Actions job uses `serpapi` by default. Change it by setting a repository
**variable** called `PROVIDER` (Settings -> Secrets and variables -> Actions -> Variables) to `browser`.

## Scheduling (every 2 hours)

`.github/workflows/parity.yml` runs at minute 0 of every even UTC hour (01:30, 03:30, ... 23:30 IST),
commits the results and the dashboard back to this branch, and can also be started by hand from the
Actions tab ("Run workflow"). GitHub may delay scheduled runs by a few minutes when busy.

To turn on the dashboard: Settings -> Pages -> Source "Deploy from a branch" -> this branch, folder `/docs`.
Then put the Pages URL in `config/settings.json` under `notifications.dashboardUrl` so alerts link to it.

If you would rather run it on a Mac that is always on, a cron line does the same thing:

```
0 */2 * * * cd /path/to/pricecomparison && PROVIDER=browser BROWSER_CHANNEL=chrome BROWSER_PROFILE_DIR=.profile npm run run >> run.log 2>&1
```

## Alerts

Alerts go out on every run that has at least one deviation (`notifications.mode: "always"`). Set it to
`"changes"` to only be told when a deviation appears or clears. Each alert lists:

* **New since last check**: deviations that were not there 2 hours ago
* **Still open**: deviations that were already there
* **Resolved**: deviations that have cleared

### Email (SMTP)

Add these as GitHub Actions secrets (Settings -> Secrets and variables -> Actions -> Secrets):
`ALERT_EMAIL_TO`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_FROM`.
For Google Workspace / Gmail: host `smtp.gmail.com`, port `587`, and an App Password (not your login password).

### WhatsApp

Two options, pick one:

* **Meta WhatsApp Cloud API**: needs a WhatsApp Business account, a phone number ID, a permanent token,
  and an **approved message template** with one body parameter `{{1}}`. Secrets: `WHATSAPP_TOKEN`,
  `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG`, `WHATSAPP_TO`.
* **Twilio**: quickest to test (sandbox works in minutes). Secrets: `TWILIO_ACCOUNT_SID`,
  `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `WHATSAPP_TO`.

`WHATSAPP_TO` is comma separated, country code first, no plus sign (e.g. `919876543210`).

Until these are set, the dashboard's Alerts section shows "Not sending" with the exact names of the
missing values.

## Adding or renaming a property

Edit `config/properties.json`. `name` is what the dashboard shows, `query` is what we search on Google,
`aliases` are other names Google may use. If a property shows "Not on Google", try a different `query`
with `node src/debug-crawl.js "<name>"` until Google finds it.
