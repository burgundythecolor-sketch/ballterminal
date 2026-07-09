#!/usr/bin/env node
/* =====================================================================
   ballterminal data fetcher
   ---------------------------------------------------------------------
   Pulls Premier League data and writes it as static files the site
   loads automatically. No dependencies — needs only Node 18+.

   Run:        node fetch_data.js
   Output:     data/data.js     <- loaded by index.html (works from file://)
               data/live.json   <- same payload as plain JSON (for servers)
               data/cache/      <- per-match cache; finished matches are
                                   fetched once and never re-fetched

   Sources:
   - FPL API (fantasy.premierleague.com): fixtures, scores, player season
     totals, transfer news. Current season only.
   - Pulselive API (footballapi.pulselive.com — the premierleague.com
     backend): per-match event stream with goal MINUTES and paired
     ASSISTS. Joined to FPL fixtures via `pulse_id`.

   First run fetches every played match (~1 request/match, throttled);
   later runs only fetch new or live matches. Re-run after each matchday
   (manually, via Task Scheduler, or a GitHub Action).
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const FPL   = "https://fantasy.premierleague.com/api";
const PULSE = "https://footballapi.pulselive.com/football";
const OUT   = path.join(__dirname, "data");
const CACHE = path.join(OUT, "cache");
const THROTTLE_MS = 350;

const HEADERS = {
  "User-Agent": "ballterminal/1.0 (personal stats dashboard)",
  "Origin": "https://www.premierleague.com",
  "Referer": "https://www.premierleague.com/",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return res.json();
}

/* ---------------------------------------------------------------------
   transforms (pure functions — unit-testable, no I/O)
   --------------------------------------------------------------------- */

/* pulselive clock label "90 +4'00" -> "90+4", "37'00" -> "37" */
function minuteLabel(clock) {
  const m = /^(\d+)(?:\s*\+\s*(\d+))?/.exec(clock?.label ?? "");
  return m ? (m[2] ? `${m[1]}+${m[2]}` : m[1]) : null;
}

/* pulselive match detail -> goals[] with side/min/scorer/assist/pen.
   Side comes from the score progression when the event carries a score;
   events without one (they happen) fall back to the scorer's team. */
function goalsFromPulse(pulse) {
  const names = {}, teamOf = {};
  for (const tl of pulse.teamLists ?? []) {
    for (const p of [...(tl.lineup ?? []), ...(tl.substitutes ?? [])]) {
      names[p.id] = p.name?.display ?? "?";
      teamOf[p.id] = tl.teamId;
    }
  }
  const homeId = pulse.teams?.[0]?.team?.id;
  const goals = [];
  let prev = { h: 0, a: 0 };
  for (const e of pulse.events ?? []) {
    const cur = e.score ? { h: e.score.homeScore ?? 0, a: e.score.awayScore ?? 0 } : null;
    if (e.type === "G") {
      const desc = (e.description ?? "").toUpperCase();
      const og = desc === "O" || desc === "OG";
      let side;
      if (cur) {
        side = cur.h > prev.h ? "h" : "a";
      } else {
        const tid = e.teamId ?? teamOf[e.personId];
        if (tid == null || homeId == null) continue; // undeterminable
        const own = tid === homeId ? "h" : "a";
        side = og ? (own === "h" ? "a" : "h") : own;
      }
      goals.push({
        side,
        min: minuteLabel(e.clock),
        scorer: (names[e.personId] ?? "?") + (og ? " (og)" : ""),
        assist: e.assistId != null ? names[e.assistId] ?? null : null,
        ...(desc === "P" ? { pen: true } : {}),
      });
      prev = cur ?? (side === "h" ? { h: prev.h + 1, a: prev.a } : { h: prev.h, a: prev.a + 1 });
    } else if (cur) {
      prev = cur;
    }
  }
  return goals;
}

/* FPL fixture stats -> goals[] fallback (no minutes/pairing available) */
function goalsFromFPL(fixture, playerName) {
  const stat = (id) => fixture.stats?.find((s) => s.identifier === id) ?? { h: [], a: [] };
  const label = (x) => (playerName[x.element] ?? "?") + (x.value > 1 ? ` ×${x.value}` : "");
  const goals = [];
  for (const side of ["h", "a"]) {
    for (const g of stat("goals_scored")[side])
      goals.push({ side, min: null, scorer: label(g), assist: null });
    for (const g of stat("own_goals")[side === "h" ? "a" : "h"])
      goals.push({ side, min: null, scorer: label(g) + " (og)", assist: null });
  }
  const assists = { h: stat("assists").h.map(label), a: stat("assists").a.map(label) };
  return { goals, assists };
}

/* fixtures -> league table rows (site TableRow shape) */
function computeTable(fixtures, teamName, uptoMW = Infinity) {
  const T = {};
  const ensure = (id) =>
    (T[id] ??= { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, results: [] });
  const played = fixtures
    .filter((f) => f.finished && f.event && f.event <= uptoMW)
    .sort((a, b) => new Date(a.kickoff_time) - new Date(b.kickoff_time));
  for (const f of played) {
    const h = ensure(f.team_h), a = ensure(f.team_a);
    h.p++; a.p++;
    h.gf += f.team_h_score; h.ga += f.team_a_score;
    a.gf += f.team_a_score; a.ga += f.team_h_score;
    if (f.team_h_score > f.team_a_score)      { h.w++; a.l++; h.results.push("W"); a.results.push("L"); }
    else if (f.team_h_score < f.team_a_score) { a.w++; h.l++; a.results.push("W"); h.results.push("L"); }
    else                                      { h.d++; a.d++; h.results.push("D"); a.results.push("D"); }
  }
  return Object.values(T)
    .sort((x, y) =>
      (y.w * 3 + y.d) - (x.w * 3 + x.d) ||
      (y.gf - y.ga) - (x.gf - x.ga) ||
      y.gf - x.gf ||
      (teamName[x.id] ?? "").localeCompare(teamName[y.id] ?? ""))
    .map((t, i) => ({
      pos: i + 1, delta: 0, team: teamName[t.id] ?? "?", teamId: t.id,
      p: t.p, w: t.w, d: t.d, l: t.l, gf: t.gf, ga: t.ga,
      form: t.results.slice(-5).join(""),
    }));
}

/* official player stats aggregated from pulselive match events.
   Goals & assists exactly as premierleague.com credits them (own goals
   excluded, penalties included, assists from the official assistId);
   clean sheets credited to the starting goalkeeper when the side
   concedes 0. Returns null when no match detail is available. */
function aggregateOfficialPlayers(pulses, extras = null) {
  if (!pulses.length && !extras?.fixtures?.length) return null;
  /* players are keyed by Opta id (pulse altIds.opta === "p" + FPL
     element.code), so pulse events and FPL supplements merge cleanly */
  const P = new Map(); // optaKey -> { name, club, goals, assists, cs }
  const ensure = (key, name, club) => {
    const p = P.get(key) ?? { name: "?", club: "", goals: 0, assists: 0, cs: 0 };
    if (name && p.name === "?") p.name = name;
    if (club) p.club = club; // latest club wins (chronological iteration)
    P.set(key, p);
    return p;
  };

  const byKickoff = [...pulses].sort((a, b) => (a.kickoff?.millis ?? 0) - (b.kickoff?.millis ?? 0));
  for (const pulse of byKickoff) {
    const clubOfTeam = {}, names = {}, teamOf = {}, keyOf = {}, gkOf = {};
    for (const t of pulse.teams ?? [])
      clubOfTeam[t.team?.id] = t.team?.club?.abbr ?? t.team?.shortName ?? "";
    for (const tl of pulse.teamLists ?? []) {
      for (const p of [...(tl.lineup ?? []), ...(tl.substitutes ?? [])]) {
        names[p.id] = p.name?.display ?? "?";
        teamOf[p.id] = tl.teamId;
        keyOf[p.id] = p.altIds?.opta ?? "x" + p.id;
      }
      const gk = (tl.lineup ?? []).find((p) => p.matchPosition === "G");
      if (gk) gkOf[tl.teamId] = gk.id;
    }
    const key = (pid) => keyOf[pid] ?? "x" + pid;
    for (const e of pulse.events ?? []) {
      if (e.type !== "G") continue;
      const desc = (e.description ?? "").toUpperCase();
      if (e.personId != null && desc !== "O" && desc !== "OG")
        ensure(key(e.personId), names[e.personId], clubOfTeam[teamOf[e.personId]]).goals++;
      if (e.assistId != null)
        ensure(key(e.assistId), names[e.assistId], clubOfTeam[teamOf[e.assistId]]).assists++;
    }
    const [h, a] = pulse.teams ?? [];
    if (h?.team && a?.team) {
      if ((a.score ?? 1) === 0 && gkOf[h.team.id] != null)
        ensure(key(gkOf[h.team.id]), names[gkOf[h.team.id]], clubOfTeam[h.team.id]).cs++;
      if ((h.score ?? 1) === 0 && gkOf[a.team.id] != null)
        ensure(key(gkOf[a.team.id]), names[gkOf[a.team.id]], clubOfTeam[a.team.id]).cs++;
    }
  }

  /* supplement from FPL per-match stats for matches whose pulselive
     detail is missing/empty — keeps season totals complete */
  if (extras?.fixtures?.length) {
    const byId = Object.fromEntries(extras.elements.map((e) => [e.id, e]));
    const clubShort = Object.fromEntries(extras.teams.map((t) => [t.id, t.short_name]));
    for (const f of extras.fixtures) {
      const stat = (id) => f.stats?.find((s) => s.identifier === id) ?? { h: [], a: [] };
      for (const side of ["h", "a"]) {
        const teamId = side === "h" ? f.team_h : f.team_a;
        for (const [ident, field] of [["goals_scored", "goals"], ["assists", "assists"]]) {
          for (const g of stat(ident)[side]) {
            const e = byId[g.element];
            if (!e) continue;
            ensure("p" + e.code, `${e.first_name} ${e.second_name}`.trim(), clubShort[teamId])[field] += g.value;
          }
        }
      }
    }
  }

  const top = (field) => [...P.values()]
    .filter((p) => p[field] > 0)
    .sort((x, y) => y[field] - x[field] || x.name.localeCompare(y.name))
    .slice(0, 10)
    .map((p) => ({ name: p.name, club: p.club, val: p[field] }));
  return { goals: top("goals"), assists: top("assists"), cleansheets: top("cs") };
}

/* bootstrap elements -> player leaderboards (site shape) */
function computePlayers(boot) {
  const clubs = Object.fromEntries(boot.teams.map((t) => [t.id, t.short_name]));
  const top = (field, filter = () => true) =>
    boot.elements
      .filter(filter)
      .sort((x, y) => (y[field] ?? 0) - (x[field] ?? 0))
      .slice(0, 10)
      .map((e) => ({ name: e.web_name, club: clubs[e.team] ?? "?", val: e[field] ?? 0 }));
  return {
    goals: top("goals_scored"),
    assists: top("assists"),
    cleansheets: top("clean_sheets", (e) => e.element_type === 1),
  };
}

/* bootstrap news -> confirmed transfer feed (site Rumour shape) */
const NEWS_RE = /\bjoin(?:ed|s)?\b|\bsign(?:ed|ing)?\b|transferred?|\bloan(?:ed)?\b|left the club|moved to|departed/i;
const DEST_RE = /(?:join(?:ed|s)?|moved to|transferred to|loan(?:ed)? (?:to|at))\s+([A-Z][\w .'&-]{2,30}?)(?=[.,]|$| on | until | for )/i;
const POS = { 1: "GK", 2: "DEF", 3: "MID", 4: "FWD" };

function relTime(iso, now = Date.now()) {
  if (!iso) return "";
  const s = (now - new Date(iso)) / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  if (s < 86400) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

function computeTransfers(boot, max = 25) {
  const clubs = Object.fromEntries(boot.teams.map((t) => [t.id, t.short_name]));
  return boot.elements
    .filter((e) => e.news && NEWS_RE.test(e.news))
    .sort((a, b) => new Date(b.news_added || 0) - new Date(a.news_added || 0))
    .slice(0, max)
    .map((e) => ({
      player: (e.web_name || `${e.first_name} ${e.second_name}`).trim(),
      pos: POS[e.element_type] ?? "?",
      from: clubs[e.team] ?? "?",
      to: (e.news.match(DEST_RE) || [])[1] ?? "—",
      fee: "n/a",
      status: "done",
      rel: 5,
      src: "FPL",
      time: relTime(e.news_added),
      note: e.news,
      _date: e.news_added ?? null,
    }));
}

/* accumulate confirmed moves into a per-window archive so past
   transfer windows become permanent pages */
function archiveTransfers(transfers) {
  const AFILE = path.join(OUT, "transfer-archive.json");
  let arch = {};
  try { arch = JSON.parse(fs.readFileSync(AFILE, "utf8")); } catch {}
  for (const t of transfers) {
    if (t.status !== "done") continue;
    const iso = t._date ?? new Date().toISOString();
    const m = new Date(iso).getUTCMonth() + 1, y = new Date(iso).getUTCFullYear();
    const win = (m >= 6 && m <= 9) ? `summer-${y}` : (m >= 10 ? `winter-${y + 1}` : `winter-${y}`);
    const w = (arch[win] ??= {
      label: win.replace("summer-", "Summer ").replace("winter-", "Winter "),
      moves: {},
    });
    const key = `${t.player}→${t.to}`;
    if (!w.moves[key])
      w.moves[key] = { player: t.player, from: t.from, to: t.to, note: t.note, date: iso.slice(0, 10) };
  }
  fs.writeFileSync(AFILE, JSON.stringify(arch));
  return Object.keys(arch).length;
}

/* ---------------------------------------------------------------------
   main
   --------------------------------------------------------------------- */
async function main() {
  fs.mkdirSync(CACHE, { recursive: true });

  console.log("[1/4] FPL bootstrap-static ...");
  const boot = await getJSON(`${FPL}/bootstrap-static/`);
  console.log("[2/4] FPL fixtures ...");
  const fixtures = await getJSON(`${FPL}/fixtures/`);

  const teamName = Object.fromEntries(boot.teams.map((t) => [t.id, t.name]));
  const playerName = Object.fromEntries(boot.elements.map((e) => [e.id, e.web_name]));

  /* -- results, enriched per match via pulselive ---------------------- */
  console.log("[3/4] match details (pulselive) ...");
  const results = {};
  const pulses = [];     // match details for official stat aggregation
  const statExtras = []; // FPL-stat fixtures covering event-data gaps
  const toFetch = fixtures.filter((f) => f.event && (f.started || f.finished));
  let fetched = 0, cached = 0, failed = 0, i = 0;

  for (const f of fixtures) {
    if (!f.event) continue; // postponed / unscheduled
    const row = {
      date: (f.kickoff_time ?? "").slice(0, 10),
      status: f.finished ? "FT" : f.started ? "LIVE" : "NS",
      home: teamName[f.team_h] ?? "?",
      away: teamName[f.team_a] ?? "?",
      hs: f.team_h_score,
      as: f.team_a_score,
      goals: [],
    };

    if (f.started || f.finished) {
      i++;
      let pulse = null;
      const scoreTotal = (f.team_h_score ?? 0) + (f.team_a_score ?? 0);
      /* pulselive event streams are sometimes missing or incomplete;
         accept a finished match's detail only when its goal count adds
         up to the scoreline — otherwise re-fetch once and, failing
         that, fall back to FPL stats (keeps season totals complete) */
      const hasDetail = (p) =>
        !f.finished || goalsFromPulse(p ?? {}).length === scoreTotal;
      const cacheFile = path.join(CACHE, `pulse-${f.pulse_id}.json`);
      if (f.finished && f.pulse_id && fs.existsSync(cacheFile)) {
        pulse = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        if (hasDetail(pulse)) cached++;
        else pulse = null; // suspect cache entry — re-fetch below
      }
      if (!pulse && f.pulse_id) {
        try {
          pulse = await getJSON(`${PULSE}/fixtures/${f.pulse_id}`);
          if (!hasDetail(pulse)) {
            console.warn(`      ! pulse ${f.pulse_id} (${row.home} v ${row.away}): no event data — using FPL stats`);
            pulse = null;
          } else if (f.finished) {
            fs.writeFileSync(cacheFile, JSON.stringify(pulse));
          }
          fetched++;
          if (fetched % 20 === 0)
            console.log(`      ${i}/${toFetch.length} matches (${fetched} fetched, ${cached} cached)`);
          await sleep(THROTTLE_MS);
        } catch (err) {
          failed++;
          console.warn(`      ! pulse ${f.pulse_id} (${row.home} v ${row.away}): ${err.message}`);
        }
      }
      if (pulse) {
        row.goals = goalsFromPulse(pulse);
        if (f.finished) pulses.push(pulse);
      } else {
        const fb = goalsFromFPL(f, playerName); // minutes unavailable
        row.goals = fb.goals;
        if (fb.assists.h.length || fb.assists.a.length) row.assists = fb.assists;
        if (f.finished && scoreTotal > 0) statExtras.push(f); // supplement aggregation
      }
    }
    (results[f.event] ??= []).push(row);
  }
  console.log(`      done: ${fetched} fetched, ${cached} from cache, ${failed} failed`);

  /* -- table, players, transfers, meta -------------------------------- */
  console.log("[4/4] table / players / transfers ...");
  const finishedMWs = fixtures.filter((f) => f.finished && f.event).map((f) => f.event);
  const lastMW = finishedMWs.length ? Math.max(...finishedMWs) : 0;

  const table = computeTable(fixtures, teamName);
  if (lastMW > 1) {
    const prevPos = Object.fromEntries(
      computeTable(fixtures, teamName, lastMW - 1).map((r) => [r.teamId, r.pos]));
    for (const r of table) r.delta = (prevPos[r.teamId] ?? r.pos) - r.pos;
  }
  for (const r of table) delete r.teamId;

  const years = fixtures.map((f) => f.kickoff_time).filter(Boolean).map((k) => +k.slice(0, 4));
  const y0 = Math.min(...years);
  const payload = {
    meta: {
      generated: new Date().toISOString(),
      season: `${y0}/${String(y0 + 1).slice(2)}`,
      maxMW: boot.events?.length ?? 38,
      currentMW: lastMW || 1,
    },
    results,
    table,
    players: (() => {
      const agg = aggregateOfficialPlayers(pulses,
        { fixtures: statExtras, elements: boot.elements, teams: boot.teams });
      if (!agg) return computePlayers(boot);
      /* clean sheets: FPL bootstrap totals cover all matches (incl. any
         event-data gaps) and match official GK counts — prefer them */
      const fplCS = computePlayers(boot).cleansheets;
      if (fplCS[0]?.val > 0) agg.cleansheets = fplCS;
      return agg;
    })(),
    transfers: computeTransfers(boot),
  };
  try { archiveTransfers(payload.transfers); } catch (err) { console.warn("      ! transfer archive:", err.message); }
  console.log(`      player stats: ${pulses.length
    ? `official (aggregated from ${pulses.length} matches` +
      (statExtras.length ? `, ${statExtras.length} filled from FPL stats)` : ")")
    : "FPL totals (no match detail)"}`);

  fs.writeFileSync(path.join(OUT, "live.json"), JSON.stringify(payload));
  fs.writeFileSync(path.join(OUT, "data.js"),
    "/* generated by fetch_data.js — do not edit */\nwindow.LIVE_DATA = " +
    JSON.stringify(payload) + ";\n");

  console.log(`\nOK  ${path.join("data", "data.js")}  (season ${payload.meta.season}, up to MW ${payload.meta.currentMW})`);
  console.log("Open index.html — the site picks it up automatically.");
}

/* export pure transforms for testing; run main() when invoked directly */
if (require.main === module) {
  main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
} else {
  module.exports = { minuteLabel, goalsFromPulse, goalsFromFPL, computeTable, computePlayers, computeTransfers, relTime, aggregateOfficialPlayers };
}
