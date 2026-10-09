import { gate, reply } from "../../../_lib/staging-auth.js";
import {
  chatGate, verifiedChatCustomer, chatToken, chatTokenHash
} from "../../../_lib/staging-chat.js";

export async function onRequestGet(context) {
  const blocked = chatGate(context) || gate(context);
  if (blocked) return blocked;
  try {
    const customer = await verifiedChatCustomer(context);
    const token = chatToken(context.request);
    if (!customer || !token) return reply({ error: "Not authenticated" }, 401);
    const rows = await context.env.DB.prepare(
      "SELECT m.id,m.sender,m.body,m.created_at FROM live_chat_messages m " +
      "JOIN live_chat_conversations c ON c.id=m.conversation_id " +
      "WHERE c.visitor_token_hash=? AND c.email=? " +
      "ORDER BY m.id DESC LIMIT 100"
    ).bind(await chatTokenHash(token), customer.email).all();
    return reply({ environment: "staging", messages: (rows.results || []).reverse() });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
