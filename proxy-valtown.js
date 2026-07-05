/* =====================================================================
   ballterminal proxy — Val Town version (val.town, free)
   ---------------------------------------------------------------------
   1. Go to val.town and sign up (free, GitHub or email)
   2. Click New -> Val, choose type "HTTP" (it runs on web requests)
   3. Replace the sample code with this entire file -> it saves and
      deploys automatically
   4. Copy the val's public URL (shown at the top, ends in .web.val.run)
   5. In index.html CONFIG set:
        FPL: { ENABLED: true, PROXY: "https://<your-val-url>/?url=", ... }

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

export default async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (request.method !== "GET") {
    return new Response("GET only", { status: 405, headers: CORS });
  }

  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return new Response("usage: ?url=<encoded target url>", { status: 400, headers: CORS });
  }

  let t;
  try {
    t = new URL(target);
  } catch {
    return new Response("bad url", { status: 400, headers: CORS });
  }
  if (t.protocol !== "https:" || !ALLOWED_HOSTS.has(t.hostname)) {
    return new Response("host not allowed", { status: 403, headers: CORS });
  }

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
    if (cache.size > 500) {
      for (const [k, v] of cache) if (v.expires < Date.now()) cache.delete(k);
    }
  }

  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": contentType, "Cache-Control": `public, max-age=${ttl}`, "X-Cache": "MISS", ...CORS },
  });
}
