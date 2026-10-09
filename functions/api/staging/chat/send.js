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
    const [created] = await context.env.DB.batch([
      context.env.DB.prepare(
        "INSERT INTO live_chat_messages(conversation_id,sender,source,body) " +
        "SELECT c.id,'customer','human',? FROM live_chat_conversations c " +
        "WHERE c.visitor_token_hash=? AND c.email=? AND c.status='open'"
      ).bind(message, digest, customer.email),
      context.env.DB.prepare(
        "UPDATE live_chat_conversations SET unread_admin=unread_admin+1, " +
        "last_message_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP " +
        "WHERE visitor_token_hash=? AND email=? AND status='open' AND " +
        "EXISTS (SELECT 1 FROM live_chat_messages m " +
        "WHERE m.conversation_id=live_chat_conversations.id AND m.body=? AND " +
        "m.sender='customer' AND m.created_at >= datetime('now','-10 seconds'))"
      ).bind(digest, customer.email, message)
    ]);
    if (created?.meta?.changes !== 1) return reply({ error: "Conversation unavailable" }, 404);
    return reply({ status: "sent", environment: "staging" });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
