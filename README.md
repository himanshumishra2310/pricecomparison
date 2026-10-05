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
scripts/setup-mac.sh     one-command setup of the office Mac (checks, tests, switches the schedule on)
scripts/run-mac.sh       one run + push, used by the Mac schedule
scripts/should-run.js    lets the GitHub backup step aside while the Mac is reporting
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

**The office Mac is the main crawler. GitHub is the backup.**

Google decides which booking sites to list from the country the viewer is in. MakeMyTrip and Goibibo only
appear on an Indian internet connection, so the crawl runs on an always-on Mac in the office. After each run
the Mac pushes the results to GitHub and the dashboard updates by itself.

**Dashboard:** https://himanshumishra2310.github.io/pricecomparison/

### One-time setup on the office Mac (about 10 minutes)

You need a Mac that stays on, plugged in, logged in, and on the office internet (no VPN to another country).

```bash
# 1. Download the project (needs git; macOS will offer to install it the first time)
git clone https://github.com/himanshumishra2310/pricecomparison.git
cd pricecomparison

# 2. Run the setup. It checks everything, tests that Google shows MakeMyTrip and Goibibo from this
#    connection, and only then switches the 2-hourly schedule on.
scripts/setup-mac.sh
```

The setup checks, in order: git and Node are installed (if Node is missing it installs it for you, no admin password needed), Chrome is
available, the Mac can push to GitHub, and Google lists MakeMyTrip or Goibibo for a few test hotels. If any
check fails it stops and says exactly what to fix, then you run it again.

**GitHub login:** Git cannot use a normal GitHub login or a Gmail sign-in. The setup asks you once for an access
token (it opens the right GitHub page and lists the 5 clicks), then saves it in the Mac keychain so the
2-hourly job can push without asking. The token lasts 1 year; make a new one and re-run the setup before it expires.

**Keep it awake:** System Settings > Battery (or Energy) > turn on "Prevent automatic sleeping when the display is off".

### What happens if the Mac is off

`.github/workflows/parity.yml` still runs every 2 hours on GitHub, but it steps aside whenever the Mac has
reported from India within the last 3 hours (`failover.indianRunFreshHours` in `config/settings.json`). If the
Mac has been silent longer, GitHub covers with its own crawl. That crawl cannot see MakeMyTrip or Goibibo, and the
dashboard shows a yellow note saying so. When the Mac comes back, it takes over again.

### Day-to-day

```bash
tail -f logs/$(date +%F).log        # watch a run
scripts/run-mac.sh                  # run once by hand
scripts/uninstall-mac-schedule.sh   # stop the schedule
```

The Mac shows a macOS notification if a crawl fails, if it cannot push to GitHub, or if Google stops showing
MakeMyTrip and Goibibo from that connection.

### Other options

* **Indian proxy instead of a Mac:** buy a proxy with an Indian address (roughly USD 5 to 15 a month) and add the
  repository secrets `PROXY_SERVER`, `PROXY_USERNAME`, `PROXY_PASSWORD`. GitHub's crawl then goes through India and
  the Mac is not needed.
* **Pause the GitHub backup completely:** set the repository variable `CRAWL_ON_GITHUB` to `false`.
* `.github/workflows/debug.yml` ("Debug one property" in the Actions tab) crawls a single property with
  diagnostics and screenshots. Use it when a property shows "Not on Google" or "Crawl error".

Note: this repository is public, so the dashboard and the price history are visible to anyone with the link.
Make the repository private if that is a concern (GitHub Pages on a private repo needs a paid plan).

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
