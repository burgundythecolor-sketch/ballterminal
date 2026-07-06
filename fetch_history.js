#!/usr/bin/env node
/* =====================================================================
   ballterminal history fetcher
   ---------------------------------------------------------------------
   Builds final league tables for every Premier League season back to
   1992/93 and writes them to data/history.js, which the site's TABLE
   section picks up automatically (season navigator).

   Run once:   node fetch_history.js        (needs Node 18+, no deps)

   Source: footballcsv/england on GitHub (public match archives, CSV
   "Round,Date,Team 1,FT,Team 2"). Tables are computed from results:
   3 pts/win, tie-break GD then GF — matching official PL standings.
   Historical seasons never change, so this only needs re-running once
   a year (it skips seasons already present unless --force).
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "data");
const OUTFILE = path.join(OUT, "history.js");
const BASE = "https://raw.githubusercontent.com/footballcsv/england/master";
const FIRST_SEASON = 1992;               // 1992-93
const THROTTLE_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* season label helpers: 1992 -> "1992/93", folder "1990s/1992-93" */
const label = (y) => `${y}/${String(y + 1).slice(2)}`;
const csvUrl = (y) =>
  `${BASE}/${Math.floor(y / 10) * 10}s/${y}-${String(y + 1).slice(2)}/eng.1.csv`;

/* normalize club names across sources/eras to one canonical form */
const NAMES = {
  "Manchester Utd": "Manchester United", "Man United": "Manchester United", "Man Utd": "Manchester United",
  "Man City": "Manchester City",
  "Newcastle Utd": "Newcastle United", "Newcastle": "Newcastle United",
  "Sheffield Utd": "Sheffield United", "Sheffield Weds": "Sheffield Wednesday",
  "Tottenham": "Tottenham Hotspur", "Spurs": "Tottenham Hotspur",
  "West Brom": "West Bromwich Albion", "West Ham": "West Ham United",
  "Wolves": "Wolverhampton Wanderers",
  "Brighton": "Brighton & Hove Albion",
  "Leicester": "Leicester City", "Leeds": "Leeds United", "Norwich": "Norwich City",
  "Luton": "Luton Town", "Ipswich": "Ipswich Town",
  "Nott'm Forest": "Nottingham Forest", "QPR": "Queens Park Rangers",
  "AFC Bournemouth": "Bournemouth",
};
/* strip club-suffix noise: "Oldham Athletic AFC" -> "Oldham Athletic" */
const clean = (name) => {
  const n = name.trim().replace(/\s+A?FC$/i, "");
  return NAMES[n] ?? n;
};

/* footballcsv "Round,Date,Team 1,FT,Team 2" -> [{date, home, away, hs, as}]
   Handles both hyphen and en/em-dash scores ("0-3" and "0–3") and
   postponement-annotated dates like "Tue Jan 12 2021(P)". */
function parseCSV(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const cols = line.split(",").map((s) => s.trim());
    if (cols.length < 5 || cols[0] === "Round") continue;
    const m = /^(\d+)\s*[–—-]\s*(\d+)/.exec(cols[3]);
    if (!m) continue;
    out.push({
      date: new Date(cols[1].replace(/\s*\(.*\)\s*$/, "")),
      home: clean(cols[2]),
      away: clean(cols[4]),
      hs: +m[1],
      as: +m[2],
    });
  }
  return out.sort((a, b) => a.date - b.date); // chronological (for form)
}

/* football-data.co.uk "Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,..."
   (fallback source for seasons footballcsv doesn't carry, 2021/22+) */
function parseFootballDataCSV(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = lines[0].split(",").map((s) => s.trim());
  const idx = Object.fromEntries(["Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"]
    .map((k) => [k, header.indexOf(k)]));
  if (Object.values(idx).some((i) => i < 0)) throw new Error("unexpected football-data header");
  const out = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const dm = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec((cols[idx.Date] ?? "").trim());
    if (!dm || !cols[idx.HomeTeam] || cols[idx.FTHG] === "" || cols[idx.FTHG] == null) continue;
    const yr = dm[3].length === 2 ? +dm[3] + 2000 : +dm[3];
    out.push({
      date: new Date(yr, +dm[2] - 1, +dm[1]),
      home: clean(cols[idx.HomeTeam]),
      away: clean(cols[idx.AwayTeam]),
      hs: +cols[idx.FTHG],
      as: +cols[idx.FTAG],
    });
  }
  return out.sort((a, b) => a.date - b.date);
}

/* fallback URL: 1995 -> mmz4281/9596/E0.csv, 2021 -> mmz4281/2122/E0.csv */
const fdUrl = (y) =>
  `https://www.football-data.co.uk/mmz4281/${String(y).slice(2)}${String(y + 1).slice(2)}/E0.csv`;

/* matches -> final table rows (site TableRow shape) */
function computeSeason(matches) {
  const T = {};
  const ensure = (t) =>
    (T[t] ??= { team: t, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, results: [] });
  for (const m of matches) {
    const h = ensure(m.home), a = ensure(m.away);
    h.p++; a.p++;
    h.gf += m.hs; h.ga += m.as;
    a.gf += m.as; a.ga += m.hs;
    if (m.hs > m.as)      { h.w++; a.l++; h.results.push("W"); a.results.push("L"); }
    else if (m.hs < m.as) { a.w++; h.l++; a.results.push("W"); h.results.push("L"); }
    else                  { h.d++; a.d++; h.results.push("D"); a.results.push("D"); }
  }
  return Object.values(T)
    .sort((x, y) =>
      (y.w * 3 + y.d) - (x.w * 3 + x.d) ||
      (y.gf - y.ga) - (x.gf - x.ga) ||
      y.gf - x.gf ||
      x.team.localeCompare(y.team))
    .map((t, i) => ({
      pos: i + 1, delta: 0, team: t.team,
      p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga,
      form: t.results.slice(-5).join(""),
    }));
}

/* season superlatives from the match list (chronological) */
function computeSuperlatives(matches) {
  if (!matches.length) return null;
  let biggest = null, highest = null;
  const seq = new Map(); // team -> chronological results
  for (const m of matches) {
    const margin = Math.abs(m.hs - m.as), total = m.hs + m.as;
    if (margin > 0 && (!biggest ||
        margin > Math.abs(biggest.hs - biggest.as) ||
        (margin === Math.abs(biggest.hs - biggest.as) && total > biggest.hs + biggest.as)))
      biggest = m;
    if (!highest || total > highest.hs + highest.as) highest = m;
    const hr = m.hs > m.as ? "W" : m.hs < m.as ? "L" : "D";
    (seq.get(m.home) ?? seq.set(m.home, []).get(m.home)).push(hr);
    (seq.get(m.away) ?? seq.set(m.away, []).get(m.away)).push(hr === "W" ? "L" : hr === "L" ? "W" : "D");
  }
  const streak = (pred) => {
    let best = { team: null, len: 0 };
    for (const [team, rs] of seq) {
      let cur = 0;
      for (const r of rs) {
        cur = pred(r) ? cur + 1 : 0;
        if (cur > best.len) best = { team, len: cur };
      }
    }
    return best;
  };
  const pick = (m) => ({
    home: m.home, away: m.away, hs: m.hs, as: m.as,
    date: m.date instanceof Date && !isNaN(m.date) ? m.date.toISOString().slice(0, 10) : null,
  });
  return {
    biggestWin: pick(biggest),
    highestScoring: pick(highest),
    winStreak: streak((r) => r === "W"),
    unbeaten: streak((r) => r !== "L"),
  };
}

/* relegation spots: 4 in 1994-95 (22 -> 20 team transition), else 3 */
const relSpots = (y) => (y === 1994 ? 4 : 3);

async function main() {
  const force = process.argv.includes("--force");
  fs.mkdirSync(OUT, { recursive: true });

  /* keep existing seasons unless --force */
  let history = {};
  if (!force && fs.existsSync(OUTFILE)) {
    const m = /window\.HISTORY = (\{[\s\S]*\});/.exec(fs.readFileSync(OUTFILE, "utf8"));
    if (m) try { history = JSON.parse(m[1]); } catch {}
  }
  /* per-season match lists (data for the per-club SEO pages) */
  const MFILE = path.join(OUT, "season-matches.json");
  let seasonMatches = {};
  if (!force && fs.existsSync(MFILE)) {
    try { seasonMatches = JSON.parse(fs.readFileSync(MFILE, "utf8")); } catch {}
  }

  /* last completed season: seasons end in May of startYear+1 */
  const now = new Date();
  const lastStart = now.getMonth() >= 5 ? now.getFullYear() - 1 : now.getFullYear() - 2;

  const HDRS = { headers: { "User-Agent": "ballterminal/1.0" } };
  for (let y = FIRST_SEASON; y <= lastStart; y++) {
    const key = label(y);
    if (history[key] && seasonMatches[key]) { console.log(`      ${key} cached`); continue; }
    const expected = y <= 1994 ? 462 : 380;

    /* primary: footballcsv archive; fallback: football-data.co.uk */
    let matches = [], src = "";
    try {
      const res = await fetch(csvUrl(y), HDRS);
      if (!res.ok) throw new Error("HTTP " + res.status);
      matches = parseCSV(await res.text());
      src = "footballcsv";
    } catch { /* fall through */ }
    if (matches.length < expected) {
      try {
        const res = await fetch(fdUrl(y), HDRS);
        if (!res.ok) throw new Error("HTTP " + res.status);
        const alt = parseFootballDataCSV(await res.text());
        if (alt.length > matches.length) { matches = alt; src = "football-data.co.uk"; }
      } catch (err) {
        if (!matches.length) {
          console.warn(`  !!  ${key} skipped: no source available (${err.message})`);
          await sleep(THROTTLE_MS);
          continue;
        }
      }
    }

    if (matches.length !== expected)
      console.warn(`      ! ${key}: ${matches.length} matches (expected ${expected}) — table may be incomplete`);
    const rows = computeSeason(matches);
    if (!rows.length) { console.warn(`  !!  ${key} skipped: no parsable matches`); continue; }
    history[key] = { rel: relSpots(y), rows, sup: computeSuperlatives(matches) };
    seasonMatches[key] = matches.map((m) => ({
      d: m.date instanceof Date && !isNaN(m.date) ? m.date.toISOString().slice(0, 10) : null,
      h: m.home, a: m.away, hs: m.hs, as: m.as,
    }));
    console.log(`  OK  ${key}  champions: ${rows[0].team} (${rows[0].w * 3 + rows[0].d} pts)  [${src}]`);
    await sleep(THROTTLE_MS);
  }

  fs.writeFileSync(OUTFILE,
    "/* generated by fetch_history.js — do not edit */\nwindow.HISTORY = " +
    JSON.stringify(history) + ";\n");
  fs.writeFileSync(MFILE, JSON.stringify(seasonMatches));
  console.log(`\nOK  ${path.join("data", "history.js")}  (${Object.keys(history).length} seasons)`);
  console.log(`OK  ${path.join("data", "season-matches.json")}  (${Object.keys(seasonMatches).length} seasons of results)`);
}

if (require.main === module) {
  main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
} else {
  module.exports = { parseCSV, parseFootballDataCSV, computeSeason, computeSuperlatives, clean, label, relSpots, fdUrl };
}
