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

  try {
    const user = await context.env.DB.prepare(
      "SELECT id, name, email, role, status, password_hash FROM users WHERE email = ? COLLATE NOCASE LIMIT 1"
    ).bind(email).first();

    if (!user || user.status !== "active" ||
        !await verifyPassword(input.password, user.password_hash)) {
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
