import { gate, readBody, reply } from "../../../_lib/staging-auth.js";
import {
  chatGate, verifiedChatCustomer, createChatToken, chatTokenHash, chatCookie
} from "../../../_lib/staging-chat.js";

export async function onRequestPost(context) {
  const blocked = chatGate(context) || gate(context, { write: true });
  if (blocked) return blocked;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: "Invalid request" }, 400); }

  const pagePath = typeof body?.page_path === "string" ? body.page_path : "/";
  if (pagePath.length > 160 || !/^\/[a-z0-9/_-]*$/i.test(pagePath)) {
    return reply({ error: "Invalid page" }, 400);
  }
  try {
    const customer = await verifiedChatCustomer(context);
    if (!customer) return reply({ error: "Not authenticated" }, 401);
    const token = createChatToken();
    await context.env.DB.prepare(
      "INSERT INTO live_chat_conversations(visitor_token_hash,name,email,page_path) VALUES(?,?,?,?)"
    ).bind(await chatTokenHash(token), customer.name, customer.email, pagePath).run();
    return reply({ status: "started", environment: "staging" }, 201,
      { "set-cookie": chatCookie(token) });
  } catch {
    return reply({ error: "Service unavailable" }, 503);
  }
}
