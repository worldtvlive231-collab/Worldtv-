import {
  gate, getSessionToken, hashSessionToken, clearSessionCookie, reply
} from "../../../_lib/staging-auth.js";

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;
  const token = getSessionToken(context.request);
  if (token) {
    try {
      await context.env.DB.prepare(
        "DELETE FROM customer_sessions WHERE token_hash = ?"
      ).bind(await hashSessionToken(token)).run();
    } catch {
      return reply({ error: "Service unavailable" }, 503);
    }
  }
  return reply({ status: "signed_out" }, 200, { "set-cookie": clearSessionCookie() });
}
