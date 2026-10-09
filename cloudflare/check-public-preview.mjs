/**
 * Read-only WORLD TV preview smoke checks.
 * Does not register/login/pay/redeem/modify D1 or Railway.
 * Run: node cloudflare/check-public-preview.mjs
 */
const origin = "https://worldtv-preview.pages.dev";
const paths = [
  "/api/staging/auth/me",
  "/api/staging/subscriptions",
  "/api/staging/admin/overview",
  "/api/staging/chat/messages",
  "/api/staging/admin/chats"
];
const checks = [
  { path: "/api/cloudflare-health", method: "GET", allowed: [200], health: true },
  ...paths.map(path => ({ path, method: "GET", allowed: [404] })),
  { path: "/api/staging/payment/paystack-validate", method: "POST", allowed: [404] }
];
let failures = 0;
for (const check of checks) {
  const url = origin + check.path;
  try {
    const res = await fetch(url, {
      method: check.method, redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { accept: "application/json" }
    });
    let passed = check.allowed.includes(res.status);
    if (passed && check.health) {
      const body = await res.json();
      passed = body.status === "ok" && body.database === "connected";
    }
    console.log((passed ? "PASS " : "FAIL ") + check.method + " " + check.path + " -> " + res.status);
    if (!passed) failures++;
  } catch (error) {
    console.error("ERROR " + check.path + ": " + String(error));
    failures++;
  }
}
if (failures > 0) {
  console.error("Safety checks failed. Do not enable production or live billing.");
  process.exitCode = 1;
} else {
  console.log("Preview health and default-disabled endpoints verified. Production is NOT ready.");
}
