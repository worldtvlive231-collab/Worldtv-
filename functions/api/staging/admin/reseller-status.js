import { readBody, reply } from '../../../_lib/staging-auth.js';
import { requireStagingAdmin } from '../../../_lib/staging-admin-access.js';

export async function onRequestPost(context) {
  const auth = await requireStagingAdmin(context, { write: true });
  if (auth.response) return auth.response;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (!Number.isSafeInteger(body?.reseller_id) || body.reseller_id <= 0 ||
      !['active','suspended'].includes(body?.status) || Object.keys(body).length !== 2) {
    return reply({ error: 'Invalid reseller update' }, 400);
  }
  try {
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        'UPDATE resellers SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>?'
      ).bind(body.status, body.reseller_id, body.status),
      context.env.DB.prepare(
        "DELETE FROM reseller_sessions WHERE reseller_id=? AND ?='suspended'"
      ).bind(body.reseller_id, body.status),
      context.env.DB.prepare(
        "INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata_json) " +
        "SELECT ?,'staging_reseller_status','reseller',CAST(id AS TEXT),? FROM resellers WHERE id=?"
      ).bind(auth.account.id, JSON.stringify({ status: body.status }), body.reseller_id)
    ]);
    return results?.[0]?.meta?.changes === 1 ?
      reply({ status: body.status, environment: 'staging' }) :
      reply({ error: 'Reseller unavailable or unchanged' }, 404);
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
