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
      body: tableHtml(rows, rel) + superlatives(label, rows, sup) + nav,
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

  /* sitemap + robots */
  fs.writeFileSync(path.join(__dirname, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [`${BASE}/index.html`, ...urls].map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`);
  fs.writeFileSync(path.join(__dirname, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);

  console.log(`OK  ${urls.length} pages -> pages/  (+ sitemap.xml, robots.txt)`);
  if (BASE.includes("example.com"))
    console.log("NOTE: rerun with --base=https://your-real-domain.com before launch.");
}

main();
