/**
 * Preview-only dry-run checkout reference, NO payment API call or redirect.
 * Requires staging customer auth plus a SECOND opt-in flag. Never receives
 * amount, currency, paid status or customer ID from the browser.
 */
import { gate, readBody, reply, makeSessionToken } from "../../../_lib/staging-auth.js";
import { stagingCustomer } from "../../../_lib/staging-entitlements.js";

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;
  if (context.env?.WORLDTV_STAGING_TEST_CHECKOUT_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }

  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: "Invalid request" }, 400); }
  if (!body || body.plan_slug !== "annual" || Object.keys(body).length !== 1) {
    return reply({ error: "Invalid plan" }, 400);
  }

  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: "Not authenticated" }, 401);
    const plan = await context.env.DB.prepare(
      "SELECT id,price_usd_cents,active FROM plans WHERE slug='annual' AND active=1 LIMIT 1"
    ).first();
    if (!plan || !Number.isSafeInteger(plan.price_usd_cents) ||
        plan.price_usd_cents <= 0) {
      return reply({ error: "Plan unavailable" }, 503);
    }
    const reference = "WTVTEST-" + makeSessionToken().slice(0, 22);
    const [checkout, order] = await context.env.DB.batch([
      context.env.DB.prepare(
        "INSERT INTO checkout_requests(reference,user_id,plan_id,provider,currency,amount_minor,status) " +
        "VALUES(?,?,?,'paystack','USD',?,'pending')"
      ).bind(reference, customer.id, plan.id, plan.price_usd_cents),
      context.env.DB.prepare(
        "INSERT INTO orders(reference,user_id,plan_id,checkout_request_id,provider,amount_minor,currency,status) " +
        "SELECT reference,user_id,plan_id,id,'paystack',amount_minor,currency,'pending' " +
        "FROM checkout_requests WHERE reference=? AND user_id=? AND plan_id=? AND status='pending'"
      ).bind(reference, customer.id, plan.id)
    ]);
    if (checkout?.meta?.changes !== 1 || order?.meta?.changes !== 1) {
      return reply({ error: "Could not prepare test order" }, 503);
    }
    return reply({
      environment: "staging",
      reference,
      amount_minor: plan.price_usd_cents,
      currency: "USD",
      payment_url: null,
      status: "dry_run_only"
    }, 201);
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
