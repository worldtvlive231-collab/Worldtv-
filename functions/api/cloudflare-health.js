/**
 * Safe, read-only health probe for the Cloudflare Pages *preview*.
 *
 * Does NOT authenticate users, accept payments, issue codes, or expose data.
 * Route: GET /api/cloudflare-health
 *
 * Remove or restrict before moving the custom production domain.
 */
export async function onRequestGet({ env }) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, nofollow"
  };

  if (!env || !env.DB || typeof env.DB.prepare !== "function") {
    return new Response(JSON.stringify({ status: "unavailable" }), { status: 503, headers });
  }

  try {
    // A constant, read-only query that only checks the presence of the new schema.
    // No customer, order, session, password, or activation-code records are accessed.
    const result = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions' LIMIT 1")
      .first();

    if (!result || result.name !== "subscriptions") {
      return new Response(JSON.stringify({ status: "unavailable" }), { status: 503, headers });
    }

    return new Response(JSON.stringify({ status: "ok", database: "connected" }), {
      status: 200,
      headers
    });
  } catch {
    // Never return internal database errors, schema details or credentials to visitors.
    return new Response(JSON.stringify({ status: "unavailable" }), { status: 503, headers });
  }
}
