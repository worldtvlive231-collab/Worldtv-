import { reply } from "../../../_lib/staging-auth.js";
import { requireStagingAdmin } from "../../../_lib/staging-admin-access.js";

export async function onRequestGet(context) {
  if (context.env?.WORLDTV_STAGING_CHAT_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }
  const auth = await requireStagingAdmin(context);
  if (auth.response) return auth.response;
  try {
    const rows = await context.env.DB.prepare(
      "SELECT id,name,email,page_path,status,unread_admin,unread_customer, " +
      "created_at,last_message_at FROM live_chat_conversations " +
      "ORDER BY last_message_at DESC,id DESC LIMIT 50"
    ).all();
    return reply({ environment: "staging", conversations: rows.results || [] });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
