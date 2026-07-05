/* =====================================================================
   ballterminal proxy — Deno Deploy / Val Town version
   ---------------------------------------------------------------------
   Same job as worker.js (Cloudflare), for free alternatives:

   OPTION A — Deno Deploy (recommended):
   1. dash.deno.com -> sign in (GitHub account, free)
   2. New Playground -> replace the sample code with this file -> Save
   3. Your URL is live instantly: https://<name>.deno.dev
   4. In index.html CONFIG set:
        FPL: { ENABLED: true, PROXY: "https://<name>.deno.dev/?url=", ... }

   OPTION B — Val Town (val.town, also free):
   1. New -> HTTP val -> paste this file
   2. Delete the LAST line (Deno.serve...) and add instead:
        export default handler;
   3. Use the val's URL the same way: "https://<val-url>/?url="

   Usage:  GET <proxy>/?url=<encodeURIComponent(target)>
   Only the two hosts below are allowed. Responses are cached in memory
   (30 s live data / 5 min static) so polling stays API-friendly.
   ===================================================================== */

const ALLOWED_HOSTS = new Set([
  "fantasy.premierleague.com",
  "footballapi.pulselive.com",
  "feeds.bbci.co.uk",      // BBC Sport RSS (transfer news)
  "www.skysports.com",     // Sky Sports RSS (transfer news)
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const ttlFor = (url) =>
  url.hostname.includes("bbci") || url.hostname.includes("skysports") ? 300
  : url.pathname.includes("bootstrap-static") ? 300
  : 30;

/* tiny in-memory cache: url -> { expires, status, contentType, body } */
const cache = new Map();

async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "GET")
    return new Response("GET only", { status: 405, headers: CORS });

  const target = new URL(request.url).searchParams.get("url");
  if (!target)
    return new Response("usage: ?url=<encoded target url>", { status: 400, headers: CORS });

  let t;
  try { t = new URL(target); } catch { return new Response("bad url", { status: 400, headers: CORS }); }
  if (t.protocol !== "https:" || !ALLOWED_HOSTS.has(t.hostname))
    return new Response("host not allowed", { status: 403, headers: CORS });

  const key = t.toString();
  const ttl = ttlFor(t);

  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return new Response(hit.body.slice(0), {
      status: hit.status,
      headers: { "Content-Type": hit.contentType, "Cache-Control": `public, max-age=${ttl}`, "X-Cache": "HIT", ...CORS },
    });
  }

  const upstream = await fetch(key, {
    headers: {
      "User-Agent": "Mozilla/5.0 (ballterminal proxy)",
      "Accept": "application/json",
      "Origin": "https://www.premierleague.com",
      "Referer": "https://www.premierleague.com/",
    },
  });
  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("Content-Type") ?? "application/json";

  if (upstream.ok) {
    cache.set(key, { expires: Date.now() + ttl * 1000, status: upstream.status, contentType, body });
    if (cache.size > 500) { // prune expired entries
      for (const [k, v] of cache) if (v.expires < Date.now()) cache.delete(k);
    }
  }

  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": contentType, "Cache-Control": `public, max-age=${ttl}`, "X-Cache": "MISS", ...CORS },
  });
}

Deno.serve(handler);
