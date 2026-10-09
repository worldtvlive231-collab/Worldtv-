import { reply, readBody } from "../../../_lib/staging-auth.js";
import { requireStagingAdmin } from "../../../_lib/staging-admin-access.js";
import { validateMessage } from "../../../_lib/staging-chat.js";

export async function onRequestPost(context) {
  if (context.env?.WORLDTV_STAGING_CHAT_ENABLED !== "true") {
    return reply({ error: "Not found" }, 404);
  }
  const auth = await requireStagingAdmin(context, { write: true });
  if (auth.response) return auth.response;
  if (!/^application\/json(?:\s*;|$)/i.test(context.request.headers.get("content-type") || "")) {
    return reply({ error: "Expected JSON" }, 415);
  }
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: "Invalid request" }, 400); }
  const id = body?.conversation_id;
  const message = validateMessage(body?.message);
  if (!Number.isSafeInteger(id) || id <= 0 || !message) {
    return reply({ error: "Invalid reply" }, 400);
  }
  try {
    const [sent] = await context.env.DB.batch([
      context.env.DB.prepare(
        "INSERT INTO live_chat_messages(conversation_id,sender,source,body) " +
        "SELECT id,'admin','human',? FROM live_chat_conversations " +
        "WHERE id=? AND status='open'"
      ).bind(message, id),
      context.env.DB.prepare(
        "UPDATE live_chat_conversations SET unread_customer=unread_customer+1, " +
        "last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP " +
        "WHERE id=? AND status='open'"
      ).bind(id)
    ]);
    if (sent?.meta?.changes !== 1) return reply({ error: "Conversation unavailable" }, 404);
    return reply({ status: "sent", environment: "staging" });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
