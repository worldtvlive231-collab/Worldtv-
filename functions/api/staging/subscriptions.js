/**
 * GET /api/staging/subscriptions
 * Read-only, account-bound. This is a test API and remains disabled
 * unless WORLDTV_STAGING_AUTH_ENABLED is set in the preview environment.
 */
import { gate, reply } from "../../_lib/staging-auth.js";
import { stagingCustomer } from "../../_lib/staging-entitlements.js";

export async function onRequestGet(context) {
  const blocked = gate(context);
  if (blocked) return blocked;

  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: "Not authenticated" }, 401);

    const rows = await context.env.DB.prepare(
      "SELECT s.id, p.slug AS plan, p.name AS plan_name, s.starts_at, s.ends_at, " +
      "CASE WHEN s.status = 'active' AND s.ends_at <= CURRENT_TIMESTAMP " +
      "THEN 'expired' ELSE s.status END AS status " +
      "FROM subscriptions AS s JOIN plans AS p ON p.id = s.plan_id " +
      "WHERE s.user_id = ? ORDER BY s.id DESC LIMIT 20"
    ).bind(customer.id).all();

    return reply({ environment: "staging", subscriptions: rows.results || [] });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
