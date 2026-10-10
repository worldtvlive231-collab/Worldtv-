import { limitAuth } from '../../../_lib/staging-account-security.js';
import {
  gate, readBody, normalizeEmail, validPassword, verifyPassword,
  makeSessionToken, hashSessionToken, expiryDate, sessionCookie, reply
} from "../../../_lib/staging-auth.js";

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;

  let input;
  try { input = await readBody(context.request); }
  catch { return reply({ error: "Invalid JSON request" }, 400); }

  const email = normalizeEmail(input?.email);
  if (!email || !validPassword(input?.password)) {
    return reply({ error: "Invalid email or password" }, 401);
  }

  const limited = await limitAuth(context, 'login', email);
  if (limited) return limited;

  try {
    const user = await context.env.DB.prepare(
      "SELECT id, name, email, role, status, email_verified_at, password_hash FROM users WHERE email = ? COLLATE NOCASE LIMIT 1"
    ).bind(email).first();

    // Perform the same password derivation for absent and ineligible accounts.
    const valid = await verifyPassword(input.password, user?.password_hash ||
      'pbkdf2_sha256_pepper$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      context.env.WORLDTV_PASSWORD_PEPPER);
    if (!user || !user.email_verified_at || user.status !== "active" || !valid) {
      return reply({ error: "Invalid email or password" }, 401);
    }

    // Only customer accounts are permitted in staging; no admin login here.
    if (user.role !== "customer") return reply({ error: "Invalid email or password" }, 401);

    const token = makeSessionToken();
    await context.env.DB.prepare(
      "INSERT INTO customer_sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)"
    ).bind(await hashSessionToken(token), user.id, expiryDate()).run();

    return reply(
      { status: "authenticated", environment: "staging" }, 200,
      { "set-cookie": sessionCookie(token) }
    );
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
