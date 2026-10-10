import { gate, getSessionToken, hashSessionToken, reply } from "../../../_lib/staging-auth.js";

export async function onRequestGet(context) {
  const blocked = gate(context);
  if (blocked) return blocked;

  const token = getSessionToken(context.request);
  if (!token) return reply({ error: "Not authenticated" }, 401);
  try {
    const user = await context.env.DB.prepare(
      "SELECT u.id, u.name, u.email, u.role FROM customer_sessions s JOIN users u ON u.id = s.user_id " +
      "WHERE s.token_hash = ? AND s.expires_at > CURRENT_TIMESTAMP AND u.email_verified_at IS NOT NULL AND u.status = 'active' LIMIT 1"
    ).bind(await hashSessionToken(token)).first();
    if (!user || user.role !== "customer") return reply({ error: "Not authenticated" }, 401);

    return reply({ status: "authenticated", environment: "staging",
      account: { id: user.id, name: user.name, email: user.email } });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
