import { reply } from '../../../_lib/staging-auth.js';
import { resellerGate, stagingReseller } from '../../../_lib/staging-reseller.js';

export async function onRequestGet(context) {
  const blocked = resellerGate(context);
  if (blocked) return blocked;
  try {
    const reseller = await stagingReseller(context);
    if (!reseller) return reply({ error: 'Not authenticated' }, 401);
    const quota = await context.env.DB.prepare(
      'SELECT allocated_count,used_count,available_count FROM reseller_code_allocation WHERE reseller_id=?'
    ).bind(reseller.id).first();
    const grants = await context.env.DB.prepare(
      "SELECT g.grant_reference,g.status,g.issued_at,g.used_at,c.code_hint,p.slug AS plan " +
      "FROM reseller_code_grants g JOIN subscription_codes c ON c.id=g.subscription_code_id " +
      "JOIN plans p ON p.id=c.plan_id WHERE g.reseller_id=? ORDER BY g.id DESC LIMIT 100"
    ).bind(reseller.id).all();
    const sales = await context.env.DB.prepare(
      "SELECT amount_minor,currency,commission_minor,created_at FROM reseller_sales " +
      "WHERE reseller_id=? ORDER BY id DESC LIMIT 50"
    ).bind(reseller.id).all();
    return reply({ environment: 'staging', reseller, quota: quota || {
      allocated_count: 0, used_count: 0, available_count: 0
    }, codes: grants.results || [], sales: sales.results || [] });
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
