/**
 * Manually document a VERIFIED Pocketi merchant record. Never creates a paid
 * order, activation code or subscription. An admin must check Pocketi directly.
 */
import { readBody, reply } from "../../../_lib/staging-auth.js";
import { requireStagingAdmin } from "../../../_lib/staging-admin-access.js";

export async function onRequestPost(context) {
  if (context.env?.WORLDTV_STAGING_POCKETI_MANUAL_ENABLED !== "true")
    return reply({ error: "Not found" }, 404);
  const auth = await requireStagingAdmin(context, { write: true });
  if (auth.response) return auth.response;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: "Invalid request" }, 400); }
  const { report_id: id, decision, review_note: note, verified_amount_pesewas: amount, merchant_confirmed: merchantConfirmed } = body || {};
  if (!Number.isSafeInteger(id) || id <= 0 || !["verified","rejected"].includes(decision) ||
      typeof note !== "string" || note.trim().length < 10 || note.trim().length > 300)
    return reply({ error: "Invalid review details" }, 400);
  if (decision === "verified" && (merchantConfirmed !== true ||
      !Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000))
    return reply({ error: "Independent Pocketi merchant confirmation and exact amount are required" }, 400);
  try {
    const result = await context.env.DB.prepare(
      "UPDATE pocketi_manual_reports SET status=?,reviewed_by=?,review_note=?, " +
      "verified_amount_pesewas=?,reviewed_at=CURRENT_TIMESTAMP " +
      "WHERE id=? AND status='pending'"
    ).bind(decision,auth.account.id,note.trim(),decision==='verified'?amount:null,id).run();
    if (result?.meta?.changes !== 1) return reply({ error: "Report not pending or does not exist" }, 409);
    return reply({ status: decision, environment: "staging", subscription_activated: false,
      note: "Manual review only. No code was issued and no payment order was created." });
  } catch { return reply({ error: "Service unavailable" }, 503); }
}
