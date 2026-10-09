/**
 * WORLD TV staging administration gate.
 *
 * It NEVER trusts a CF Access JWT without signature verification. It requires
 * BOTH a Cloudflare Access-signed identity and an active D1 admin role, with
 * an explicit email allowlist, and remains disabled until env flags are set.
 * It is NOT configured in Cloudflare by this commit.
 */
import { reply, normalizeEmail } from "./staging-auth.js";

function decodeJSONBase64Url(input) {
  if (typeof input !== "string" || input.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(input))
    throw new Error("Invalid token");
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(
    atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), ch => ch.charCodeAt(0)
  );
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function signatureBytes(input) {
  if (typeof input !== "string" || !/^[A-Za-z0-9_-]{100,1024}$/.test(input))
    throw new Error("Invalid signature");
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(
    atob(base64 + "=".repeat((4 - base64.length % 4) % 4)), ch => ch.charCodeAt(0)
  );
}

export async function verifyAccessIdentity(jwt, { teamDomain, audience, fetchJwks = fetch }) {
  if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(teamDomain || "") ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(audience || "") ||
      typeof jwt !== "string" || jwt.length > 12000) return null;

  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const header = decodeJSONBase64Url(parts[0]);
    const payload = decodeJSONBase64Url(parts[1]);
    if (header?.alg !== "RS256" || typeof header.kid !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)) return null;

    const now = Math.floor(Date.now() / 1000);
    if (payload.iss !== teamDomain ||
        !(payload.aud === audience || Array.isArray(payload.aud) && payload.aud.includes(audience)) ||
        !Number.isInteger(payload.exp) || payload.exp <= now ||
        (payload.nbf !== undefined && (!Number.isInteger(payload.nbf) || payload.nbf > now)) ||
        (payload.iat !== undefined && (!Number.isInteger(payload.iat) || payload.iat > now + 60))) {
      return null;
    }

    const email = normalizeEmail(payload.email);
    if (!email) return null;
    const res = await fetchJwks(teamDomain + "/cdn-cgi/access/certs", {
      headers: { accept: "application/json" }, redirect: "error"
    });
    if (!res.ok) return null;
    const jwks = await res.json();
    if (!Array.isArray(jwks?.keys) || jwks.keys.length > 30) return null;
    const jwk = jwks.keys.find(x =>
      x.kid === header.kid && x.kty === "RSA" && x.use !== "enc" &&
      (x.alg === undefined || x.alg === "RS256") &&
      typeof x.n === "string" && typeof x.e === "string");
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, signatureBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    return ok ? { email, subject: payload.sub || null } : null;
  } catch {
    return null;
  }
}

export async function requireStagingAdmin(context, { write = false, fetchJwks } = {}) {
  const url = new URL(context.request.url);
  if (url.hostname !== "worldtv-preview.pages.dev" ||
      context.env?.WORLDTV_STAGING_ADMIN_ENABLED !== "true") {
    return { response: reply({ error: "Not found" }, 404) };
  }
  if (write) {
    if (context.request.headers.get("origin") !== url.origin) {
      return { response: reply({ error: "Forbidden" }, 403) };
    }
    const contentType = context.request.headers.get("content-type") || "";
    if (!/^application\\/json(?:\\s*;|$)/i.test(contentType)) {
      return { response: reply({ error: "Expected JSON" }, 415) };
    }
  }
  if (!context.env?.DB || typeof context.env.DB.prepare !== "function") {
    return { response: reply({ error: "Unavailable" }, 503) };
  }
  const token = context.request.headers.get("cf-access-jwt-assertion");
  const identity = await verifyAccessIdentity(token, {
    teamDomain: context.env.WORLDTV_ACCESS_TEAM_DOMAIN,
    audience: context.env.WORLDTV_ACCESS_AUD,
    ...(fetchJwks ? { fetchJwks } : {})
  });
  if (!identity) return { response: reply({ error: "Forbidden" }, 403) };

  const allowlist = String(context.env.WORLDTV_STAGING_ADMIN_EMAILS || "")
    .split(/[;,]/).map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!allowlist.includes(identity.email)) {
    return { response: reply({ error: "Forbidden" }, 403) };
  }
  try {
    const account = await context.env.DB.prepare(
      "SELECT id, email FROM users WHERE email = ? COLLATE NOCASE " +
      "AND role = 'admin' AND status = 'active' LIMIT 1"
    ).bind(identity.email).first();
    if (!account) return { response: reply({ error: "Forbidden" }, 403) };
    return { account };
  } catch {
    return { response: reply({ error: "Unavailable" }, 503) };
  }
}
