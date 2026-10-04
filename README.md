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
* Prices are Google's listed nightly rate in INR for 2 adults, exactly as shown in Google's own price
  list for the hotel. Google's "with taxes + fees" tooltip values are not used.
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
docs/history.json        one line per run with the summary numbers and who was undercut (the History tab)
scripts/run-mac.sh       one run + push, used by the Mac schedule
scripts/install-mac-schedule.sh   switches the every-2-hours Mac schedule on
```

## Running it

```bash
npm install
cp .env.example .env      # fill in alert details, see below

npm run run:fixture       # replay sample data, no network. Good for checking the dashboard.
npm run run:browser       # crawl Google Hotels in Chromium (free)
npm run run:serpapi       # crawl via SerpApi (needs SERPAPI_KEY, paid, most reliable)
npm run serve             # view the dashboard locally at http://localhost:8080 (or just open docs/index.html in a browser)
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
| `browser` | free | medium | **Default.** Google can show a CAPTCHA to cloud IPs (GitHub Actions). Works best from a normal machine. `BROWSER_CHANNEL=chrome` and `BROWSER_PROFILE_DIR=.profile` reduce CAPTCHAs. |
| `serpapi` | paid | high | 99 searches per run (33 x 3 windows), ~1,200/day, ~36,000/month at 2-hourly. Check SerpApi pricing before enabling. |
| `fixture` | free | n/a | Replays `test/fixtures/prices.json`. For tests and dashboard previews only. |


## Scheduling (every 2 hours)

**Default: GitHub Actions.** `.github/workflows/parity.yml` runs every 2 hours on GitHub's servers,
commits the results and republishes the dashboard. Nothing to install, nothing to keep awake.
Google loads fine from there and shows Saltstayz.com against the international OTAs (Agoda,
Booking.com, Expedia, Trip.com, Hotels.com, Traveloka, Vio, and others).

**Important limitation:** Google chooses which booking sites to list based on the viewer's country.
From GitHub's servers (USA) it never lists **MakeMyTrip or Goibibo**, so those two columns stay empty
in GitHub-run results. To include MakeMyTrip and Goibibo the crawl has to run from an Indian internet
connection: an always-on Mac in the office (setup below), or a server/proxy in India.
If you switch to the Mac, turn the GitHub schedule off first (comment out the `schedule:` block in
`parity.yml`) so the two do not push over each other.

**Dashboard:** https://himanshumishra2310.github.io/pricecomparison/

The page is served from the `gh-pages` branch, which `.github/workflows/pages.yml` refreshes from
`docs/` every time a crawl pushes new results. Give GitHub a minute or two after a push.

To see the dashboard on your own machine, open `docs/index.html` in any browser (double-click it),
or run `npm run serve` and open http://localhost:8080. Both show the latest run on that machine.

### Option B: run on an always-on Mac (gets MakeMyTrip and Goibibo too)

One-time setup on the Mac (about 5 minutes):

```bash
# 1. Get the code. Needs git and Node 20+ (brew install node).
git clone https://github.com/himanshumishra2310/pricecomparison.git
cd pricecomparison
npm install

# 2. Make sure git can push without asking for a password (GitHub Desktop login or `gh auth login` both work),
#    then test a push once:  git push

# 3. Optional: alert details
cp .env.example .env     # fill in email / WhatsApp values, see Alerts below

# 4. Check one property in a visible Chrome window to confirm Google's page is read correctly
HEADLESS=false node src/debug-crawl.js "Cyber Hub" D0

# 5. Do one full run by hand (takes 10-20 minutes for 33 properties x 3 dates)
scripts/run-mac.sh && tail -20 logs/$(date +%F).log

# 6. Switch on the every-2-hours schedule
scripts/install-mac-schedule.sh
```

The schedule uses macOS launchd (`~/Library/LaunchAgents/com.saltstayz.rateparity.plist`), which also
catches up after the Mac wakes from sleep. Keep the Mac awake (System Settings -> Energy -> Prevent
automatic sleeping, or an app like Amphetamine) and logged in. Logs are in `logs/`, screenshots of each
Google page in `debug/`. Stop it with `scripts/uninstall-mac-schedule.sh`.

`.github/workflows/debug.yml` ("Debug one property" in the Actions tab) crawls a single property with
diagnostics and screenshots. Use it when a property shows "Not on Google" or "Crawl error" to see
exactly what Google returned.

Note: this repository is public, so the dashboard and the price history are visible to anyone with
the link. Make the repository private if that is a concern (GitHub Pages on a private repo needs a paid plan).

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
