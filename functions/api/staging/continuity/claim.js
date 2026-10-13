import { gate, readBody, reply } from '../../../_lib/staging-auth.js';
import { stagingCustomer } from '../../../_lib/staging-entitlements.js';
import { continuityEmailHash } from '../../../_lib/staging-continuity.js';

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;
  if (context.env?.WORLDTV_STAGING_CONTINUITY_ENABLED !== 'true') {
    return reply({ error: 'Not found' }, 404);
  }
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (!body || Object.keys(body).length !== 0) return reply({ error: 'Invalid request' }, 400);
  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: 'Not authenticated' }, 401);
    const emailHash = await continuityEmailHash(customer.email,
      context.env.WORLDTV_CONTINUITY_HMAC_SECRET);
    const claimToken = crypto.randomUUID();
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        "UPDATE continuity_entitlements SET status='claimed',claimed_user_id=?,claim_token=?," +
        "claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=(" +
        "SELECT id FROM continuity_entitlements WHERE email_hash=? AND status='eligible' " +
        "AND source_ends_at>CURRENT_TIMESTAMP ORDER BY source_ends_at DESC LIMIT 1) " +
        "AND NOT EXISTS(SELECT 1 FROM subscriptions WHERE user_id=? AND status='active' " +
        "AND ends_at>CURRENT_TIMESTAMP)"
      ).bind(customer.id, claimToken, emailHash, customer.id),
      context.env.DB.prepare(
        "INSERT INTO subscriptions(user_id,plan_id,status,starts_at,ends_at) " +
        "SELECT ?,p.id,'active',CURRENT_TIMESTAMP,c.source_ends_at " +
        "FROM continuity_entitlements c JOIN plans p ON p.slug=c.plan_slug AND p.active=1 " +
        "WHERE c.claim_token=? AND c.claimed_user_id=? AND c.status='claimed' " +
        "AND NOT EXISTS(SELECT 1 FROM subscriptions WHERE user_id=? AND status='active' " +
        "AND ends_at>CURRENT_TIMESTAMP)"
      ).bind(customer.id, claimToken, customer.id, customer.id),
      context.env.DB.prepare(
        "INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata_json) " +
        "SELECT ?,'staging_continuity_claim','continuity_entitlement',CAST(id AS TEXT),NULL " +
        "FROM continuity_entitlements WHERE claim_token=?"
      ).bind(customer.id, claimToken)
    ]);
    return results?.[0]?.meta?.changes === 1 && results?.[1]?.meta?.changes === 1 ?
      reply({ environment: 'staging', status: 'restored' }) :
      reply({ error: 'No eligible entitlement' }, 409);
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
