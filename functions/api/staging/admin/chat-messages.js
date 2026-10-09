import { reply } from "../../../_lib/staging-auth.js";
import { requireStagingAdmin } from "../../../_lib/staging-admin-access.js";

export async function onRequestGet(context) {
  if (context.env?.WORLDTV_STAGING_CHAT_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }
  const auth = await requireStagingAdmin(context);
  if (auth.response) return auth.response;
  const id = Number(new URL(context.request.url).searchParams.get("conversation_id"));
  if (!Number.isSafeInteger(id) || id <= 0) return reply({ error: "Invalid conversation" }, 400);
  try {
    const rows = await context.env.DB.prepare(
      "SELECT id,sender,source,body,created_at FROM live_chat_messages " +
      "WHERE conversation_id=? ORDER BY id DESC LIMIT 100"
    ).bind(id).all();
    return reply({ environment: "staging", messages: (rows.results || []).reverse() });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
