import { readBody, reply } from '../../../_lib/staging-auth.js';
import { requireStagingAdmin } from '../../../_lib/staging-admin-access.js';

export async function onRequestPost(context) {
  const auth = await requireStagingAdmin(context, { write: true });
  if (auth.response) return auth.response;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (!Number.isSafeInteger(body?.reseller_id) || body.reseller_id <= 0 ||
      !Number.isSafeInteger(body?.count) || body.count < 1 || body.count > 1000 ||
      Object.keys(body).length !== 2) {
    return reply({ error: 'Invalid allocation' }, 400);
  }
  try {
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        "INSERT INTO reseller_code_allocation(reseller_id,allocated_count,used_count,available_count) " +
        "SELECT id,?,0,? FROM resellers WHERE id=? AND status='active' " +
        "ON CONFLICT(reseller_id) DO UPDATE SET allocated_count=allocated_count+excluded.allocated_count," +
        "available_count=available_count+excluded.available_count,updated_at=CURRENT_TIMESTAMP"
      ).bind(body.count, body.count, body.reseller_id),
      context.env.DB.prepare(
        "INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata_json) " +
        "SELECT ?,'staging_reseller_codes_allocated','reseller',CAST(id AS TEXT),? " +
        "FROM resellers WHERE id=? AND status='active'"
      ).bind(auth.account.id, JSON.stringify({ count: body.count }), body.reseller_id)
    ]);
    return results?.[0]?.meta?.changes === 1 ?
      reply({ status: 'allocated', count: body.count, environment: 'staging' }) :
      reply({ error: 'Active reseller not found' }, 404);
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
