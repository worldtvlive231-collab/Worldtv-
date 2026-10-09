import { verifyTurnstile } from "../../../_lib/staging-turnstile.js";
import { gate, readBody, normalizeEmail, validPassword, hashPassword, reply } from "../../../_lib/staging-auth.js";

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;
  // Registration must be approved independently of staging login.
  // Leave this false until email verification and abuse defenses are configured.
  if (context.env?.WORLDTV_STAGING_REGISTRATION_ENABLED !== "true") {
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

  const verified = await verifyTurnstile(input?.turnstileToken, {
    secret: context.env?.WORLDTV_TURNSTILE_SECRET,
    remoteip: context.request.headers.get("cf-connecting-ip") || undefined
  });
  if (!verified) return reply({ error: "Verification required" }, 403);

  try {
    const encodedPassword = await hashPassword(input.password);
    await context.env.DB.prepare(
      "INSERT INTO users(name, email, password_hash, role, status) VALUES(?, ?, ?, 'customer', 'active')"
    ).bind(name, email, encodedPassword).run();
    return reply({ status: "created", environment: "staging" }, 201);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message || ""))) {
      return reply({ error: "Unable to create account" }, 409);
    }
    return reply({ error: "Service unavailable" }, 503);
  }
}
