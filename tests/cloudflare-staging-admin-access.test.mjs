import test from "node:test";
import assert from "node:assert/strict";
import { verifyAccessIdentity, requireStagingAdmin } from "../functions/_lib/staging-admin-access.js";
import { onRequestGet as overview } from "../functions/api/staging/admin/overview.js";

const TEAM = "https://worldtvtest.cloudflareaccess.com";
const AUD = "worldtvpreviewtestaud123456789";
const EMAIL = "admin@example.invalid";
const HOST = "https://worldtv-preview.pages.dev";
const encoder = new TextEncoder();

function b64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
function payloadPart(obj) {
  return b64url(encoder.encode(JSON.stringify(obj)));
}

async function keysAndJwt(override = {}) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048,
      publicExponent: new Uint8Array([1,0,1]), hash: "SHA-256" },
    true, ["sign", "verify"]
  );
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  jwk.kid = "test-key-1";
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: TEAM, aud: AUD, email: EMAIL,
    exp: now + 600, iat: now, sub: "trusted-account-1", ...override };
  const signingInput = [
    payloadPart({ alg: "RS256", typ: "JWT", kid: "test-key-1" }),
    payloadPart(payload)
  ].join(".");
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", privateKey, encoder.encode(signingInput)
  ));
  const jwt = signingInput + "." + b64url(signature);
  const fetchJwks = async url => {
    assert.equal(url, TEAM + "/cdn-cgi/access/certs");
    return { ok: true, json: async () => ({ keys: [jwk] }) };
  };
  return { jwt, fetchJwks };
}

const mockDB = {
  prepare(sql) {
    assert.match(sql, /role = 'admin'/);
    return { bind: email => {
      assert.equal(email, EMAIL);
      return { first: async () => ({ id: 91, email }) };
    } };
  }
};
const env = {
  DB: mockDB, WORLDTV_STAGING_ADMIN_ENABLED: "true",
  WORLDTV_ACCESS_TEAM_DOMAIN: TEAM, WORLDTV_ACCESS_AUD: AUD,
  WORLDTV_STAGING_ADMIN_EMAILS: EMAIL
};
const request = jwt => new Request(HOST + "/api/staging/admin/overview", {
  headers: { "cf-access-jwt-assertion": jwt }
});

test("admin routes stay disabled on preview by default", async () => {
  const response = await overview({
    request: new Request(HOST + "/api/staging/admin/overview"), env: { DB: mockDB }
  });
  assert.equal(response.status, 404);
});

test("Cloudflare Access JWT signature + issuer + audience + expiry are checked", async () => {
  const { jwt, fetchJwks } = await keysAndJwt();
  const ok = await verifyAccessIdentity(jwt, { teamDomain: TEAM, audience: AUD, fetchJwks });
  assert.deepEqual(ok, { email: EMAIL, subject: "trusted-account-1" });
  const tampered = jwt.split(".");
  tampered[1] = payloadPart({ iss: TEAM, aud: AUD, email: "attacker@example.invalid",
    exp: Math.floor(Date.now()/1000) + 600 });
  assert.equal(await verifyAccessIdentity(tampered.join("."), {
    teamDomain: TEAM, audience: AUD, fetchJwks
  }), null);
  assert.equal(await verifyAccessIdentity(jwt, {
    teamDomain: TEAM, audience: "wrong-audience-123456", fetchJwks
  }), null);
  assert.equal(await verifyAccessIdentity(jwt, {
    teamDomain: "https://attacker.example.com", audience: AUD, fetchJwks
  }), null);
});

test("expired or unsupported Access tokens fail closed", async () => {
  const { jwt, fetchJwks } = await keysAndJwt({
    exp: Math.floor(Date.now()/1000) - 1
  });
  assert.equal(await verifyAccessIdentity(jwt, {
    teamDomain: TEAM, audience: AUD, fetchJwks
  }), null);
  assert.equal(await verifyAccessIdentity("not.jwt.valid", {
    teamDomain: TEAM, audience: AUD, fetchJwks
  }), null);
});

test("Access identity needs admin D1 role AND explicit email allowlist", async () => {
  const { jwt, fetchJwks } = await keysAndJwt();
  const approved = await requireStagingAdmin({
    request: request(jwt), env
  }, { fetchJwks });
  assert.deepEqual(approved.account, { id: 91, email: EMAIL });

  const denied = await requireStagingAdmin({
    request: request(jwt), env: { ...env, WORLDTV_STAGING_ADMIN_EMAILS: "nobody@example.invalid" }
  }, { fetchJwks });
  assert.equal(denied.response.status, 403);

  const roleDenied = await requireStagingAdmin({
    request: request(jwt), env: { ...env,
      DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } }
  }, { fetchJwks });
  assert.equal(roleDenied.response.status, 403);

  const wrongHost = await requireStagingAdmin({
    request: new Request("https://myworldtvlive.com/api/staging/admin/overview", {
      headers: { "cf-access-jwt-assertion": jwt }
    }), env
  }, { fetchJwks });
  assert.equal(wrongHost.response.status, 404);
});
