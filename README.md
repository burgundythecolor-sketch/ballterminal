# ballterminal

Terminal-style Premier League dashboard: results (with goalscorers, minutes and assists), league table, player stats, transfer wire.

## Use

Open `index.html`. Without data it runs on built-in mock data.

## Live data

```
node fetch_data.js
```

Needs Node 18+. Pulls the current season from the FPL API (fixtures, scores, player totals, confirmed-transfer news) and the premierleague.com backend (goal minutes + paired assists per match), then writes `data/data.js`, which the site picks up automatically — no server needed.

The first run fetches every played match (a few minutes, throttled); finished matches are cached in `data/cache/` so later runs only fetch what's new. Re-run after each matchday, or schedule it (Windows Task Scheduler / cron / GitHub Action).

## Historical tables (back to 1992/93)

```
node fetch_history.js
```

Builds final league tables for every PL season from match archives (footballcsv/england) and writes `data/history.js`. The TABLE section then gets a season navigator (◂ ▸) from 1992/93 to now. One-time run; re-run once a year to append the latest season. Ships with 1992/93 pre-seeded.

## Properly live (~30–60s behind, no PC needed)

Deploy `worker.js` as a Cloudflare Worker (free, ~5 min — steps are at the top of that file), then in `index.html` set:

```js
FPL: {
  ENABLED: true,
  PROXY: "https://<your-worker>.workers.dev/?url=",
  ...
}
```

The site then loads everything straight from the sources through the worker: results with goal minutes and paired assists (pulselive), live-computed league table, player stats, and confirmed transfers. While matches are in play it re-fetches every 60 s automatically. The worker caches at the edge (30 s live / 5 min static), so polling stays friendly to the APIs.

## Data source priority

1. Live mode (`CONFIG.FPL.ENABLED` + worker proxy)
2. `data/data.js` (from `fetch_data.js`)
3. `CONFIG.API_BASE` — your own backend serving the JSON shapes documented in `index.html`
4. Built-in mock data
