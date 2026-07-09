#!/usr/bin/env node
/* =====================================================================
   ballterminal SEO page builder
   ---------------------------------------------------------------------
   Generates static, data-filled landing pages that target common
   searches ("premier league table 1994/95", "premier league top
   scorers") and funnel visitors into the terminal. Real content on
   every page — thin/doorway pages get penalized, these don't.

   Run:     node build_pages.js --base=https://yoursite.com
            (--base sets absolute URLs in sitemap + canonical tags;
             rerun once you know your real domain)

   Reads:   data/history.js   (fetch_history.js output)
            data/live.json    (fetch_data.js output, optional)
   Writes:  pages/*.html, sitemap.xml, robots.txt

   Re-run after fetch_history.js each season, or whenever live data
   should be refreshed into the static pages.
   ===================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");

const BASE = (process.argv.find((a) => a.startsWith("--base=")) ?? "--base=https://example.com")
  .slice(7).replace(/\/$/, "");
const OUT = path.join(__dirname, "pages");

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const slug = (label) => label.replace("/", "-");           // 1992/93 -> 1992-93

/* ------------------------- load data ------------------------- */
function loadHistory() {
  const src = fs.readFileSync(path.join(__dirname, "data", "history.js"), "utf8");
  const m = /window\.HISTORY = (\{[\s\S]*\});/.exec(src);
  return m ? JSON.parse(m[1]) : {};
}
function loadLive() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data", "live.json"), "utf8")); }
  catch { return null; }
}
function loadMatches() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data", "season-matches.json"), "utf8")); }
  catch { return {}; }
}
function loadRecords() {
  try {
    const src = fs.readFileSync(path.join(__dirname, "data", "records.js"), "utf8");
    const m = /window\.RECORDS = (\{[\s\S]*\});/.exec(src);
    /* records.js uses JS object syntax; evaluate it in a sandbox-free way */
    return m ? new Function("return " + m[1])() : null;
  } catch { return null; }
}
function loadLegends() {
  try {
    const src = fs.readFileSync(path.join(__dirname, "data", "legends.js"), "utf8");
    const m = /window\.LEGENDS = (\{[\s\S]*\});/.exec(src);
    return m ? new Function("return " + m[1])() : null;
  } catch { return null; }
}
const clubSlug = (name) => name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ------------------------- template ------------------------- */
const CSS = `body{background:#0a0d13;color:#cdd6e4;font-family:-apple-system,Segoe UI,sans-serif;
margin:0;padding:24px;line-height:1.55}main{max-width:860px;margin:0 auto}
h1{font-size:26px}a{color:#38d6ff}p.lede{color:#8b96a8;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:18px 0}
th{font-size:11px;letter-spacing:.08em;color:#5b6577;text-align:right;padding:8px 10px;border-bottom:1px solid #1f2534}
th.l,td.l{text-align:left}td{padding:7px 10px;text-align:right;border-bottom:1px solid #161b26}
tr.champ td{color:#2dffa3}tr.rel td{color:#ff5370}
.nav{display:flex;gap:16px;margin:22px 0;font-size:14px;flex-wrap:wrap}
.cta{display:inline-block;margin:10px 0 26px;padding:10px 18px;border:1px solid #2c3550;border-radius:10px;
color:#2dffa3;text-decoration:none;font-family:ui-monospace,monospace}
footer{margin-top:34px;font-size:12px;color:#5b6577}`;

function page({ title, desc, canonical, h1, lede, body, jsonld }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<style>${CSS}</style>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ""}
</head>
<body><main>
<h1>${esc(h1)}</h1>
<p class="lede">${esc(lede)}</p>
<a class="cta" href="../index.html">❯ open the live ballterminal — table · results · stats · transfers</a>
${body}
<footer>ballterminal — Premier League results, tables and stats, 1992/93 to today.</footer>
</main></body></html>`;
}

const tableHtml = (rows, rel) => `<table>
<thead><tr><th class="l">#</th><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
<tbody>${rows.map((r) => {
  const cls = r.pos === 1 ? ' class="champ"' : r.pos > rows.length - rel ? ' class="rel"' : "";
  const gd = r.gf - r.ga;
  return `<tr${cls}><td class="l">${r.pos}</td><td class="l">${esc(r.team)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}</td><td>${r.ga}</td><td>${gd > 0 ? "+" : ""}${gd}</td><td><b>${r.w * 3 + r.d}</b></td></tr>`;
}).join("\n")}</tbody></table>`;

/* ------------------------- build ------------------------- */
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const history = loadHistory();
  const live = loadLive();
  const seasonMatches = loadMatches();
  const records = loadRecords();
  const legends = loadLegends();
  const seasons = Object.keys(history).sort();
  const urls = [];

  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

  /* season superlatives: match-derived (sup, from fetch_history.js)
     plus table-derived ones that always exist */
  function superlatives(label, rows, sup) {
    const champ = rows[0], runnerUp = rows[1];
    const margin = (champ.w * 3 + champ.d) - (runnerUp.w * 3 + runnerUp.d);
    const att = [...rows].sort((a, b) => b.gf - a.gf)[0];
    const def = [...rows].sort((a, b) => a.ga - b.ga)[0];
    const items = [];
    const gb = legends?.goldenBoot?.[label];
    if (gb) items.push(`<b>Golden Boot:</b> ${esc(gb.name)} — ${gb.goals} goals`);
    if (sup?.biggestWin) {
      const b = sup.biggestWin;
      items.push(`<b>Biggest win:</b> ${esc(b.home)} ${b.hs}–${b.as} ${esc(b.away)}${b.date ? ` (${fmtDate(b.date)})` : ""}`);
    }
    if (sup?.highestScoring) {
      const h = sup.highestScoring;
      items.push(`<b>Highest-scoring match:</b> ${esc(h.home)} ${h.hs}–${h.as} ${esc(h.away)} — ${h.hs + h.as} goals${h.date ? ` (${fmtDate(h.date)})` : ""}`);
    }
    if (sup?.winStreak?.team)
      items.push(`<b>Longest winning run:</b> ${esc(sup.winStreak.team)}, ${sup.winStreak.len} consecutive wins`);
    if (sup?.unbeaten?.team)
      items.push(`<b>Longest unbeaten run:</b> ${esc(sup.unbeaten.team)}, ${sup.unbeaten.len} matches`);
    items.push(`<b>Best attack:</b> ${esc(att.team)} — ${att.gf} goals scored`);
    items.push(`<b>Meanest defence:</b> ${esc(def.team)} — ${def.ga} goals conceded`);
    items.push(`<b>Title margin:</b> ${margin === 0 ? "level on points, decided on goal difference" : `${margin} point${margin === 1 ? "" : "s"}`}`);
    return `<h2>Season superlatives — ${esc(label)}</h2>
<ul style="line-height:1.9;font-size:15px">${items.map((x) => `<li>${x}</li>`).join("\n")}</ul>`;
  }

  /* one landing page per historical season */
  seasons.forEach((label, i) => {
    const { rows, rel = 3, sup } = history[label];
    const champ = rows[0], runnerUp = rows[1];
    const relegated = rows.slice(rows.length - rel).map((r) => r.team);
    const file = `premier-league-table-${slug(label)}.html`;
    const canonical = `${BASE}/pages/${file}`;
    const lede = `Final ${label} Premier League standings — all ${rows.length} clubs with played, won, drawn, lost, goals and points. ` +
      `${champ.team} won the ${label} title with ${champ.w * 3 + champ.d} points, ${(champ.w * 3 + champ.d) - (runnerUp.w * 3 + runnerUp.d)} clear of ${runnerUp.team}. ` +
      `Relegated: ${relegated.join(", ")}.`;
    const nav = `<div class="nav">
${i > 0 ? `<a href="premier-league-table-${slug(seasons[i - 1])}.html">◂ ${esc(seasons[i - 1])} table</a>` : ""}
<a href="index.html">All seasons 1992–${seasons[seasons.length - 1].slice(-2)}</a>
${i < seasons.length - 1 ? `<a href="premier-league-table-${slug(seasons[i + 1])}.html">${esc(seasons[i + 1])} table ▸</a>` : ""}
</div>`;
    fs.writeFileSync(path.join(OUT, file), page({
      title: `Premier League Table ${label} — Final Standings & Results`,
      desc: `The final ${label} Premier League table. ${champ.team} champions with ${champ.w * 3 + champ.d} points; ${relegated.join(", ")} relegated. Full standings for all ${rows.length} clubs.`,
      canonical,
      h1: `Premier League Table ${label} — Final Standings`,
      lede,
      body: tableHtml(rows, rel) + superlatives(label, rows, sup) +
        (seasonMatches[label]?.length
          ? `<h2>Club season pages — ${esc(label)}</h2><p style="line-height:2">${rows.map((r) =>
              `<a href="${clubSlug(r.team)}-${slug(label)}.html">${esc(r.team)}</a>`).join(" · ")}</p>`
          : "") + nav,
      jsonld: {
        "@context": "https://schema.org", "@type": "Dataset",
        name: `Premier League ${label} final table`,
        description: lede, url: canonical,
        keywords: [`premier league table ${label}`, `epl standings ${label}`, `${champ.team} ${label}`,
          `biggest premier league win ${label}`, `premier league top scorers ${label}`],
      },
    }));
    urls.push(canonical);
  });

  /* per-club season pages ("arsenal 1997/98 results") */
  let clubPages = 0;
  for (const label of seasons) {
    const ms = seasonMatches[label];
    if (!ms?.length) continue;
    const { rows } = history[label];
    for (const r of rows) {
      const team = r.team;
      const games = ms.filter((m) => m.h === team || m.a === team)
        .sort((x, y) => ((x.d ?? "") < (y.d ?? "") ? -1 : 1));
      if (!games.length) continue;
      const pts = r.w * 3 + r.d;
      const file = `${clubSlug(team)}-${slug(label)}.html`;
      const canonical = `${BASE}/pages/${file}`;
      const lede = `${team}'s ${label} Premier League season: finished ${r.pos}${["st","nd","rd"][r.pos-1] ?? "th"} with ${pts} points (${r.w} wins, ${r.d} draws, ${r.l} defeats), scoring ${r.gf} and conceding ${r.ga}. Every result below.`;
      const prevSeason = seasons[seasons.indexOf(label) - 1];
      const nextSeason = seasons[seasons.indexOf(label) + 1];
      const clubLink = (s) => s && history[s]?.rows.some((x) => x.team === team) && seasonMatches[s]?.length
        ? `<a href="${clubSlug(team)}-${slug(s)}.html">${esc(team)} ${esc(s)}</a>` : "";
      const body = `<table>
<thead><tr><th class="l"></th><th class="l">Date</th><th class="l">Fixture</th><th>Score</th></tr></thead>
<tbody>${games.map((m) => {
        const isH = m.h === team;
        const f = isH ? m.hs : m.as, g = isH ? m.as : m.hs;
        const res = f > g ? "W" : f < g ? "L" : "D";
        const c = res === "W" ? "#2dffa3" : res === "L" ? "#ff5370" : "#ffb347";
        return `<tr><td class="l" style="color:${c};font-weight:700">${res}</td><td class="l">${esc(m.d ?? "")}</td><td class="l">${isH ? `<b>${esc(team)}</b> v ${esc(m.a)}` : `${esc(m.h)} v <b>${esc(team)}</b>`}</td><td>${m.hs}–${m.as}</td></tr>`;
      }).join("\n")}</tbody></table>
<div class="nav">${clubLink(prevSeason)}<a href="premier-league-table-${slug(label)}.html">${esc(label)} full table</a><a href="${clubSlug(team)}-club-records.html">${esc(team)} club records</a>${clubLink(nextSeason)}</div>`;
      fs.writeFileSync(path.join(OUT, file), page({
        title: `${team} ${label} — Results, Record & Final Position`,
        desc: lede, canonical,
        h1: `${team} — ${label} Season`, lede, body,
        jsonld: { "@context": "https://schema.org", "@type": "Dataset",
          name: `${team} ${label} Premier League results`, description: lede, url: canonical,
          keywords: [`${team.toLowerCase()} ${label} results`, `${team.toLowerCase()} ${label} season`, `${team.toLowerCase()} fixtures ${label}`] },
      }));
      urls.push(canonical);
      clubPages++;
    }
  }
  if (clubPages) console.log(`      ${clubPages} club season pages`);
  else console.log("      no season-matches.json yet — run fetch_history.js to enable club pages");

  /* per-club all-time record pages */
  if (Object.keys(seasonMatches).length) {
    const ord = (n) => n + (["st", "nd", "rd"][((n + 90) % 100 - 10) % 10 - 1] ?? "th");
    const clubs = new Map();
    for (const label of seasons) {
      for (const r of history[label].rows) {
        const pts = r.w * 3 + r.d;
        const c = clubs.get(r.team) ?? { team: r.team, seasons: [], titles: 0,
          w: 0, d: 0, l: 0, gf: 0, ga: 0,
          bestPos: 99, worstPos: 0, maxPts: -1, minPts: 9999 };
        c.seasons.push(label);
        if (r.pos === 1) c.titles++;
        c.w += r.w; c.d += r.d; c.l += r.l; c.gf += r.gf; c.ga += r.ga;
        if (r.pos < c.bestPos) { c.bestPos = r.pos; c.bestPosSeason = label; }
        if (r.pos > c.worstPos) { c.worstPos = r.pos; c.worstPosSeason = label; }
        if (pts > c.maxPts) { c.maxPts = pts; c.maxPtsSeason = label; }
        if (pts < c.minPts) { c.minPts = pts; c.minPtsSeason = label; }
        clubs.set(r.team, c);
      }
    }
    for (const [label, ms] of Object.entries(seasonMatches)) {
      const run = new Map(); // team -> current streaks within this season
      for (const m of [...ms].sort((a, b) => ((a.d ?? "") < (b.d ?? "") ? -1 : 1))) {
        for (const side of ["h", "a"]) {
          const team = side === "h" ? m.h : m.a;
          const c = clubs.get(team);
          if (!c) continue;
          const f = side === "h" ? m.hs : m.as, g = side === "h" ? m.as : m.hs;
          const res = f > g ? "W" : f < g ? "L" : "D";
          const margin = f - g;
          if (margin > 0 && (!c.bigWin || margin > c.bigWin.margin))
            c.bigWin = { h: m.h, a: m.a, hs: m.hs, as: m.as, margin, season: label };
          if (margin < 0 && (!c.bigLoss || margin < c.bigLoss.margin))
            c.bigLoss = { h: m.h, a: m.a, hs: m.hs, as: m.as, margin, season: label };
          const s = run.get(team) ?? { win: 0, unb: 0 };
          s.win = res === "W" ? s.win + 1 : 0;
          s.unb = res !== "L" ? s.unb + 1 : 0;
          if (!c.winStreak || s.win > c.winStreak.len) c.winStreak = { len: s.win, season: label };
          if (!c.unbeaten || s.unb > c.unbeaten.len) c.unbeaten = { len: s.unb, season: label };
          run.set(team, s);
        }
      }
    }
    const row = (k, v) => `<tr><td class="l">${k}</td><td class="l"><b>${v}</b></td></tr>`;
    for (const c of [...clubs.values()].sort((a, b) => a.team.localeCompare(b.team))) {
      const file = `${clubSlug(c.team)}-club-records.html`;
      const canonical = `${BASE}/pages/${file}`;
      const span = `${c.seasons[0]}–${c.seasons[c.seasons.length - 1].slice(-5)}`;
      const lede = `${c.team}'s Premier League records: ${c.seasons.length} season${c.seasons.length > 1 ? "s" : ""} (${span})` +
        (c.titles ? `, ${c.titles} title${c.titles > 1 ? "s" : ""}` : "") +
        `, best finish ${ord(c.bestPos)} (${c.bestPosSeason}), record points ${c.maxPts} (${c.maxPtsSeason}).`;
      fs.writeFileSync(path.join(OUT, file), page({
        title: `${c.team} — Premier League Club Records & History`,
        desc: lede, canonical,
        h1: `${c.team} — Premier League Club Records`, lede,
        body: `<table><tbody>
${row("Premier League seasons", `${c.seasons.length} (${esc(span)})`)}
${c.titles ? row("Titles", c.titles) : ""}
${row("Best finish", `${ord(c.bestPos)} — ${esc(c.bestPosSeason)}`)}
${row("Worst finish", `${ord(c.worstPos)} — ${esc(c.worstPosSeason)}`)}
${row("Most points in a season", `${c.maxPts} — ${esc(c.maxPtsSeason)}`)}
${row("Fewest points in a season", `${c.minPts} — ${esc(c.minPtsSeason)}`)}
${c.bigWin ? row("Biggest win", `${esc(c.bigWin.h)} ${c.bigWin.hs}–${c.bigWin.as} ${esc(c.bigWin.a)} — ${esc(c.bigWin.season)}`) : ""}
${c.bigLoss ? row("Heaviest defeat", `${esc(c.bigLoss.h)} ${c.bigLoss.hs}–${c.bigLoss.as} ${esc(c.bigLoss.a)} — ${esc(c.bigLoss.season)}`) : ""}
${c.winStreak?.len ? row("Longest winning run (single season)", `${c.winStreak.len} — ${esc(c.winStreak.season)}`) : ""}
${c.unbeaten?.len ? row("Longest unbeaten run (single season)", `${c.unbeaten.len} — ${esc(c.unbeaten.season)}`) : ""}
${row("All-time PL record", `${c.w + c.d + c.l} played · ${c.w}W ${c.d}D ${c.l}L · ${c.gf} scored, ${c.ga} conceded`)}
</tbody></table>
<h2>${esc(c.team)} season by season</h2>
<p style="line-height:2">${c.seasons.map((s) =>
        `<a href="${clubSlug(c.team)}-${slug(s)}.html">${esc(s)}</a>`).join(" · ")}</p>
<div class="nav"><a href="premier-league-clubs.html">All clubs</a><a href="index.html">Season tables</a></div>`,
        jsonld: { "@context": "https://schema.org", "@type": "Dataset",
          name: `${c.team} Premier League club records`, description: lede, url: canonical,
          keywords: [`${c.team.toLowerCase()} premier league record`, `${c.team.toLowerCase()} biggest win`, `${c.team.toLowerCase()} best season`] },
      }));
      urls.push(canonical);
    }
    /* clubs index */
    const file = "premier-league-clubs.html";
    const canonical = `${BASE}/pages/${file}`;
    fs.writeFileSync(path.join(OUT, file), page({
      title: "Premier League Clubs — Records & History of Every Team",
      desc: `Club records and season-by-season history for all ${clubs.size} teams to have played in the Premier League since 1992/93.`,
      canonical, h1: "Every Premier League Club — Records & History",
      lede: `All ${clubs.size} clubs to have appeared in the Premier League, with all-time records, best and worst seasons, biggest wins and streaks.`,
      body: `<ul style="columns:2;line-height:2;font-size:15px">${[...clubs.values()].sort((a, b) => a.team.localeCompare(b.team)).map((c) =>
        `<li><a href="${clubSlug(c.team)}-club-records.html">${esc(c.team)}</a> — ${c.seasons.length} season${c.seasons.length > 1 ? "s" : ""}${c.titles ? `, ${c.titles} title${c.titles > 1 ? "s" : ""}` : ""}</li>`).join("\n")}</ul>
<div class="nav"><a href="premier-league-records.html">All-time records</a><a href="index.html">Season tables</a></div>`,
    }));
    urls.push(canonical);
    console.log(`      ${clubs.size} club record pages`);
  }

  /* all-time records page */
  if (records) {
    const file = "premier-league-records.html";
    const canonical = `${BASE}/pages/${file}`;
    const lede = "All-time Premier League records: most goals, most assists, most points, biggest wins, longest unbeaten runs and more — player and team records from 1992/93 to today.";
    const recTable = (list) => `<table><thead><tr><th class="l">Record</th><th class="l">Holder</th><th class="l">Detail</th></tr></thead>
<tbody>${list.map((r) => `<tr><td class="l">${esc(r.k)}</td><td class="l"><b>${esc(r.v)}</b></td><td class="l" style="color:#5b6577">${esc(r.d)}</td></tr>`).join("\n")}</tbody></table>`;
    fs.writeFileSync(path.join(OUT, file), page({
      title: "Premier League Records — All-Time Player & Team Records",
      desc: lede, canonical,
      h1: "Premier League All-Time Records", lede,
      body: `<h2>Player records</h2>${recTable(records.player)}<h2>Team records</h2>${recTable(records.team)}
<div class="nav"><a href="index.html">Tables for every season</a></div>`,
      jsonld: { "@context": "https://schema.org", "@type": "Dataset",
        name: "Premier League all-time records", description: lede, url: canonical,
        keywords: ["premier league records", "most premier league goals", "premier league all time top scorers", "fastest premier league goal"] },
    }));
    urls.push(canonical);
  }

  /* golden boot history + player legend pages */
  if (legends?.goldenBoot) {
    const gbSeasons = Object.keys(legends.goldenBoot).sort();
    const file = "premier-league-golden-boot-winners.html";
    const canonical = `${BASE}/pages/${file}`;
    const lede = `Every Premier League Golden Boot winner from ${gbSeasons[0]} to ${gbSeasons[gbSeasons.length - 1]} — the league's top scorer for all ${gbSeasons.length} seasons, with goal totals.`;
    fs.writeFileSync(path.join(OUT, file), page({
      title: "Premier League Golden Boot Winners — Every Season's Top Scorer",
      desc: lede, canonical,
      h1: "Premier League Golden Boot Winners", lede,
      body: `<table><thead><tr><th class="l">Season</th><th class="l">Top scorer</th><th>Goals</th></tr></thead>
<tbody>${gbSeasons.map((s) => {
        const g = legends.goldenBoot[s];
        const link = history[s] ? `<a href="premier-league-table-${slug(s)}.html">${esc(s)}</a>` : esc(s);
        return `<tr><td class="l">${link}</td><td class="l"><b>${esc(g.name)}</b></td><td>${g.goals}</td></tr>`;
      }).join("\n")}</tbody></table>
<div class="nav"><a href="premier-league-records.html">All-time records</a><a href="index.html">Tables for every season</a></div>`,
      jsonld: { "@context": "https://schema.org", "@type": "Dataset",
        name: "Premier League Golden Boot winners by season", description: lede, url: canonical,
        keywords: ["premier league golden boot winners", "premier league top scorer by season", "epl golden boot list"] },
    }));
    urls.push(canonical);
  }

  if (legends?.players?.length) {
    const holds = (name) => (records ? [...records.player, ...records.team] : [])
      .filter((r) => r.v.includes(name)).map((r) => `${r.k.toLowerCase()} (${r.v.split("—")[1]?.trim() ?? ""})`);
    for (const p of legends.players) {
      const file = `${clubSlug(p.name)}-premier-league-stats.html`;
      const canonical = `${BASE}/pages/${file}`;
      const bits = [];
      if (p.apps) bits.push(`${p.apps} appearances`);
      if (p.goals) bits.push(`${p.goals} goals`);
      if (p.assists) bits.push(`${p.assists} assists`);
      if (p.cs) bits.push(`${p.cs} clean sheets`);
      const rec = holds(p.name);
      const lede = `${p.name}'s complete Premier League career (${p.span}): ${bits.join(", ")}. ${p.note}`;
      fs.writeFileSync(path.join(OUT, file), page({
        title: `${p.name} — Premier League Career Stats (Goals, Assists, Appearances)`,
        desc: lede, canonical,
        h1: `${p.name} — Premier League Career Stats`, lede,
        body: `<table><tbody>
<tr><td class="l">Premier League career</td><td class="l"><b>${esc(p.span)}</b></td></tr>
${p.apps ? `<tr><td class="l">Appearances</td><td class="l"><b>${p.apps}</b></td></tr>` : ""}
${p.goals ? `<tr><td class="l">Goals</td><td class="l"><b>${p.goals}</b></td></tr>` : ""}
${p.assists ? `<tr><td class="l">Assists</td><td class="l"><b>${p.assists}</b></td></tr>` : ""}
${p.cs ? `<tr><td class="l">Clean sheets</td><td class="l"><b>${p.cs}</b></td></tr>` : ""}
</tbody></table>
${rec.length ? `<h2>All-time records held</h2><ul style="line-height:1.9">${rec.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
<div class="nav"><a href="premier-league-records.html">All-time records</a><a href="premier-league-golden-boot-winners.html">Golden Boot winners</a></div>`,
        jsonld: { "@context": "https://schema.org", "@type": "ProfilePage",
          mainEntity: { "@type": "Person", name: p.name, description: lede },
          url: canonical },
      }));
      urls.push(canonical);
    }
    /* legends index for internal linking */
    const file = "premier-league-legends.html";
    const canonical = `${BASE}/pages/${file}`;
    fs.writeFileSync(path.join(OUT, file), page({
      title: "Premier League Legends — Career Stats of the Greats",
      desc: "Career Premier League statistics for the league's greatest players: Shearer, Henry, Rooney, Giggs, Čech and more.",
      canonical, h1: "Premier League Legends — Career Stats",
      lede: "Complete Premier League career numbers for the greats of the competition. Every player below has finished their Premier League chapter, so these figures are final.",
      body: `<ul style="columns:2;line-height:2;font-size:15px">${legends.players.map((p) =>
        `<li><a href="${clubSlug(p.name)}-premier-league-stats.html">${esc(p.name)}</a> — ${p.goals ? p.goals + " goals" : p.cs ? p.cs + " clean sheets" : p.apps + " apps"}</li>`).join("\n")}</ul>
<div class="nav"><a href="premier-league-golden-boot-winners.html">Golden Boot winners</a><a href="premier-league-records.html">All-time records</a></div>`,
    }));
    urls.push(canonical);
  }

  /* current-season stat pages from live.json */
  if (live?.players && live?.meta?.season) {
    const s = live.meta.season, sl = slug(s);
    const boards = [
      ["top-scorers", "Top Scorers", "goals", "Goals"],
      ["most-assists", "Most Assists", "assists", "Assists"],
      ["clean-sheets", "Most Clean Sheets", "cleansheets", "Clean sheets"],
    ];
    for (const [key, name, field, col] of boards) {
      const list = live.players[field] ?? [];
      if (!list.length) continue;
      const file = `premier-league-${key}-${sl}.html`;
      const canonical = `${BASE}/pages/${file}`;
      const lede = `Premier League ${name.toLowerCase()} for the ${s} season: ${list[0].name} leads with ${list[0].val}. Top ten ranking below, live version in the terminal.`;
      const body = `<table><thead><tr><th class="l">#</th><th class="l">Player</th><th class="l">Club</th><th>${col}</th></tr></thead>
<tbody>${list.map((p, j) => `<tr><td class="l">${j + 1}</td><td class="l">${esc(p.name)}</td><td class="l">${esc(p.club)}</td><td><b>${p.val}</b></td></tr>`).join("\n")}</tbody></table>
<div class="nav"><a href="index.html">All seasons</a></div>`;
      fs.writeFileSync(path.join(OUT, file), page({
        title: `Premier League ${name} ${s} | ballterminal`,
        desc: lede, canonical,
        h1: `Premier League ${name} — ${s}`, lede, body,
        jsonld: { "@context": "https://schema.org", "@type": "Dataset", name: `Premier League ${name} ${s}`, description: lede, url: canonical },
      }));
      urls.push(canonical);
    }
  }

  /* hub page linking every season (internal linking + long-tail) */
  const hubCanonical = `${BASE}/pages/index.html`;
  fs.writeFileSync(path.join(OUT, "index.html"), page({
    title: "Premier League Tables by Season — Every Final Standing 1992/93 to Today",
    desc: `Final Premier League tables for every season since 1992/93 — champions, relegations and full standings for all ${seasons.length} seasons.`,
    canonical: hubCanonical,
    h1: "Premier League Tables — Every Season Since 1992/93",
    lede: "Final standings for every Premier League season, computed from complete match archives. Click a season for the full table, or open the terminal for the live season, results with scorers, player stats and transfer news.",
    body: `<ul style="columns:2;font-size:15px;line-height:2">${seasons.map((label) => {
      const c = history[label].rows[0];
      return `<li><a href="premier-league-table-${slug(label)}.html">${esc(label)}</a> — ${esc(c.team)}</li>`;
    }).join("\n")}</ul>`,
  }));
  urls.push(hubCanonical);

  /* sitemap (with lastmod so crawlers see daily freshness) + robots */
  const today = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(__dirname, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [`${BASE}/index.html`, ...urls].map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod></url>`).join("\n") +
    `\n</urlset>\n`);
  fs.writeFileSync(path.join(__dirname, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);

  console.log(`OK  ${urls.length} pages -> pages/  (+ sitemap.xml, robots.txt)`);
  if (BASE.includes("example.com"))
    console.log("NOTE: rerun with --base=https://your-real-domain.com before launch.");
}

main();
