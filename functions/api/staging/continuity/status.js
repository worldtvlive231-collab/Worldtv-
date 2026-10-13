import { gate, reply } from '../../../_lib/staging-auth.js';
import { stagingCustomer } from '../../../_lib/staging-entitlements.js';
import { continuityEmailHash } from '../../../_lib/staging-continuity.js';

export async function onRequestGet(context) {
  const blocked = gate(context);
  if (blocked) return blocked;
  if (context.env?.WORLDTV_STAGING_CONTINUITY_ENABLED !== 'true') {
    return reply({ error: 'Not found' }, 404);
  }
  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: 'Not authenticated' }, 401);
    const hash = await continuityEmailHash(customer.email, context.env.WORLDTV_CONTINUITY_HMAC_SECRET);
    const row = await context.env.DB.prepare(
      "SELECT plan_slug,source_ends_at,status FROM continuity_entitlements " +
      "WHERE email_hash=? AND status IN ('eligible','claimed') " +
      "ORDER BY source_ends_at DESC LIMIT 1"
    ).bind(hash).first();
    return reply({ environment: 'staging', continuity: row ? {
      plan: row.plan_slug, ends_at: row.source_ends_at, status: row.status
    } : null });
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
