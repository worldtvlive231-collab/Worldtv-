import { gate, readBody, reply } from "../../../_lib/staging-auth.js";
import {
  chatGate, verifiedChatCustomer, chatToken, chatTokenHash, validateMessage
} from "../../../_lib/staging-chat.js";

export async function onRequestPost(context) {
  const blocked = chatGate(context) || gate(context, { write: true });
  if (blocked) return blocked;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: "Invalid request" }, 400); }
  const message = validateMessage(body?.message);
  if (!message) return reply({ error: "Invalid message" }, 400);
  try {
    const customer = await verifiedChatCustomer(context);
    const token = chatToken(context.request);
    if (!customer || !token) return reply({ error: "Not authenticated" }, 401);
    const digest = await chatTokenHash(token);
    // The D1 message-insert triggers update unread_admin atomically.
    // Do NOT increment counters using a separate recent-text lookup.
    const created = await context.env.DB.prepare(
      "INSERT INTO live_chat_messages(conversation_id,sender,source,body) " +
      "SELECT c.id,'customer','human',? FROM live_chat_conversations c " +
      "WHERE c.visitor_token_hash=? AND c.email=? AND c.status='open'"
    ).bind(message, digest, customer.email).run();
    if (created?.meta?.changes !== 1) return reply({ error: "Conversation unavailable" }, 404);
    return reply({ status: "sent", environment: "staging" });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
