import { limitAuth, mailReady, allowedRecipient, deliverIdentityToken } from '../../../_lib/staging-account-security.js';
import { verifyTurnstile } from "../../../_lib/staging-turnstile.js";
import { gate, readBody, normalizeEmail, validPassword, hashPassword, reply } from "../../../_lib/staging-auth.js";

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;
  // Registration must be approved independently of staging login.
  // Leave this false until email verification and abuse defenses are configured.
  if (context.env?.WORLDTV_STAGING_REGISTRATION_ENABLED !== "true" || context.env?.WORLDTV_STAGING_IDENTITY_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }

  let input;
  try { input = await readBody(context.request); }
  catch { return reply({ error: "Invalid JSON request" }, 400); }

  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const email = normalizeEmail(input?.email);
  if (!name || name.length > 120 || /[\u0000-\u001f]/.test(name) ||
      !email || !validPassword(input?.password)) {
    return reply({ error: "Check your name, email, and password (minimum 12 characters)" }, 400);
  }

  const limited = await limitAuth(context, 'register', email);
  if (limited) return limited;
  if (!mailReady(context) || !allowedRecipient(context, email)) return reply({ error: 'Service unavailable' }, 503);

  const verified = await verifyTurnstile(input?.turnstileToken, {
    secret: context.env?.WORLDTV_TURNSTILE_SECRET,
    hostname: new URL(context.request.url).hostname,
    action: "register",
    remoteip: context.request.headers.get("cf-connecting-ip") || undefined,
    verify: context.data?.turnstileTestVerify || fetch
  });
  if (!verified) return reply({ error: "Verification required" }, 403);

  try {
    const encodedPassword = await hashPassword(input.password);
    await context.env.DB.prepare(
      "INSERT INTO users(name, email, password_hash, role, status) VALUES(?, ?, ?, 'customer', 'active')"
    ).bind(name, email, encodedPassword).run();
    const user = await context.env.DB.prepare("SELECT id,email FROM users WHERE email=? COLLATE NOCASE").bind(email).first();
    await deliverIdentityToken(context, user, 'verify');
    return reply({ status: "verification_required", environment: "staging" }, 201);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || ""))) {
      return reply({ error: "Unable to create account" }, 409);
    }
    return reply({ error: "Service unavailable" }, 503);
  }
}
