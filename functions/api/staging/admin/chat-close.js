import { reply, readBody } from "../../../_lib/staging-auth.js";
import { requireStagingAdmin } from "../../../_lib/staging-admin-access.js";

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
  if (!Number.isSafeInteger(id) || id <= 0) return reply({ error: "Invalid conversation" }, 400);
  try {
    const result = await context.env.DB.prepare(
      "UPDATE live_chat_conversations SET status='closed', updated_at=CURRENT_TIMESTAMP " +
      "WHERE id=? AND status='open'"
    ).bind(id).run();
    return result?.meta?.changes === 1 ?
      reply({ status: "closed", environment: "staging" }) :
      reply({ error: "Conversation unavailable" }, 404);
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
