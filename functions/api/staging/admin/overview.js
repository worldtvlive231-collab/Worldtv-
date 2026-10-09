/**
 * Read-only staging administration overview.
 * Requires a cryptographically verified Cloudflare Access JWT, an explicit
 * allowlist, a D1 role='admin' record, and an enabled preview-only flag.
 */
import { reply } from "../../../_lib/staging-auth.js";
import { requireStagingAdmin } from "../../../_lib/staging-admin-access.js";

export async function onRequestGet(context) {
  const auth = await requireStagingAdmin(context);
  if (auth.response) return auth.response;
  try {
    const stats = await context.env.DB.prepare(
      "SELECT (SELECT COUNT(*) FROM users WHERE role='customer') AS customers, " +
      "(SELECT COUNT(*) FROM subscriptions WHERE status='active' AND ends_at > CURRENT_TIMESTAMP) AS active_subscriptions, " +
      "(SELECT COUNT(*) FROM orders WHERE status='paid') AS paid_orders, " +
      "(SELECT COUNT(*) FROM live_chat_conversations WHERE status='open') AS open_conversations"
    ).first();
    return reply({ environment: "staging", stats: {
      customers: stats?.customers ?? 0,
      active_subscriptions: stats?.active_subscriptions ?? 0,
      paid_orders: stats?.paid_orders ?? 0,
      open_conversations: stats?.open_conversations ?? 0
    } });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
