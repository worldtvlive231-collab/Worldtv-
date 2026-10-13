/**
 * Test-only manual intake for a hosted Pocketi receipt reference.
 * A report is NEVER proof of payment; it never changes orders or grants access.
 */
import { gate, readBody, reply } from "../../../_lib/staging-auth.js";
import { stagingCustomer } from "../../../_lib/staging-entitlements.js";

function reportGate(context, write = false) {
  if (context.env?.WORLDTV_STAGING_POCKETI_MANUAL_ENABLED !== "true")
    return reply({ error: "Not found" }, 404);
  return gate(context, { write });
}
export function normalizeTestPocketiReference(value) {
  if (typeof value !== "string") return null;
  const reference = value.trim().toUpperCase();
  return /^WTVTEST-POCKETI-[A-Z0-9_-]{6,64}$/.test(reference) ? reference : null;
}

export async function onRequestPost(context) {
  const blocked = reportGate(context, true);
  if (blocked) return blocked;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: "Invalid request" }, 400); }
  const reference = normalizeTestPocketiReference(body?.reference);
  if (!reference) return reply({ error: "Use a test reference beginning WTVTEST-POCKETI-" }, 400);
  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: "Sign in with a verified test account" }, 401);
    const recent = await context.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM pocketi_manual_reports WHERE user_id=? " +
      "AND submitted_at >= datetime('now','-1 day')"
    ).bind(customer.id).first();
    if (Number(recent?.n) >= 5) return reply({ error: "Daily review limit reached" }, 429);
    const pending = await context.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM pocketi_manual_reports WHERE user_id=? AND status='pending'"
    ).bind(customer.id).first();
    if (Number(pending?.n) >= 2) return reply({ error: "Please wait for the current review" }, 429);
    await context.env.DB.prepare(
      "INSERT INTO pocketi_manual_reports(user_id,provider_reference) VALUES(?,?)"
    ).bind(customer.id,reference).run();
    return reply({ status: "pending_review", message: "Test receipt submitted. This does not confirm payment or activate a subscription." }, 201);
  } catch (error) {
    if (/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(String(error))) return reply({ error: "This reference has already been reported" }, 409);
    return reply({ error: "Service unavailable" }, 503);
  }
}

export async function onRequestGet(context) {
  const blocked = reportGate(context);
  if (blocked) return blocked;
  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: "Sign in with a verified test account" }, 401);
    const rows = await context.env.DB.prepare(
      "SELECT id,provider_reference,status,submitted_at,reviewed_at FROM pocketi_manual_reports " +
      "WHERE user_id=? ORDER BY id DESC LIMIT 20"
    ).bind(customer.id).all();
    return reply({ environment: "staging", reports: rows.results || [], note: "A verified review status does not itself issue or activate a code." });
  } catch { return reply({ error: "Service unavailable" }, 503); }
}
