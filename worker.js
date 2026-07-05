/* =====================================================================
   ballterminal proxy — Cloudflare Worker
   ---------------------------------------------------------------------
   Forwards requests to the FPL and premierleague.com APIs with CORS
   headers (browsers can't call them directly) and short-lived caching,
   so the site can poll for live scores without hammering the sources.

   Deploy (once, ~5 min, free):
   1. cloudflare.com -> sign up (free plan)
   2. Workers & Pages -> Create -> Worker -> name it (e.g.
      "ballterminal-proxy") -> Deploy
   3. Edit code -> replace everything with this file -> Deploy
   4. Copy the URL (https://ballterminal-proxy.<you>.workers.dev)
   5. In index.html CONFIG set:
        FPL: { ENABLED: true, PROXY: "https://<worker-url>/?url=", ... }

   Usage:  GET <worker>/?url=<encodeURIComponent(target)>
   Only the two hosts below are allowed.
   ===================================================================== */

const ALLOWED_HOSTS = new Set([
  "fantasy.premierleague.com",
  "footballapi.pulselive.com",
  "feeds.bbci.co.uk",      // BBC Sport RSS (transfer news)
  "www.skysports.com",     // Sky Sports RSS (transfer news)
]);

/* cache seconds by endpoint: static-ish data longer, live data short */
function ttlFor(url) {
  if (url.hostname.includes("bbci") || url.hostname.includes("skysports")) return 300;
  if (url.pathname.includes("bootstrap-static")) return 300;
  return 30;
}

export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "GET")
      return new Response("GET only", { status: 405, headers: cors });

    const target = new URL(request.url).searchParams.get("url");
    if (!target)
      return new Response("usage: ?url=<encoded target url>", { status: 400, headers: cors });

    let t;
    try { t = new URL(target); } catch { return new Response("bad url", { status: 400, headers: cors }); }
    if (t.protocol !== "https:" || !ALLOWED_HOSTS.has(t.hostname))
      return new Response("host not allowed", { status: 403, headers: cors });

    const ttl = ttlFor(t);
    const upstream = await fetch(t.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (ballterminal proxy)",
        "Accept": "application/json",
        "Origin": "https://www.premierleague.com",
        "Referer": "https://www.premierleague.com/",
      },
      cf: { cacheTtl: ttl, cacheEverything: true }, // edge cache
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": `public, max-age=${ttl}`,
        ...cors,
      },
    });
  },
};
