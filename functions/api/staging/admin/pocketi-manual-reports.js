/** Access-protected, read-only queue of hosted Pocketi test claims. */
import { reply } from "../../../_lib/staging-auth.js";
import { requireStagingAdmin } from "../../../_lib/staging-admin-access.js";

export async function onRequestGet(context) {
  if (context.env?.WORLDTV_STAGING_POCKETI_MANUAL_ENABLED !== "true")
    return reply({ error: "Not found" }, 404);
  const auth = await requireStagingAdmin(context);
  if (auth.response) return auth.response;
  try {
    const rows = await context.env.DB.prepare(
      "SELECT r.id, r.provider_reference, r.status, r.submitted_at, " +
      "r.reviewed_at, r.review_note, r.verified_amount_pesewas, u.email AS customer_email " +
      "FROM pocketi_manual_reports r JOIN users u ON u.id=r.user_id " +
      "ORDER BY r.id DESC LIMIT 100"
    ).all();
    return reply({ environment: "staging", reports: rows.results || [], note: "Check actual merchant records independently. This queue is not payment evidence." });
  } catch { return reply({ error: "Service unavailable" }, 503); }
}
