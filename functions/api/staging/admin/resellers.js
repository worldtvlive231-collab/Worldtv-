import { normalizeEmail, validPassword, hashPassword, readBody, reply } from '../../../_lib/staging-auth.js';
import { requireStagingAdmin } from '../../../_lib/staging-admin-access.js';

export async function onRequestGet(context) {
  const auth = await requireStagingAdmin(context);
  if (auth.response) return auth.response;
  try {
    const rows = await context.env.DB.prepare(
      "SELECT r.id,r.name,r.email,r.phone,r.commission_percent,r.status,r.created_at," +
      "COALESCE(a.allocated_count,0) AS allocated_count,COALESCE(a.used_count,0) AS used_count," +
      "COALESCE(a.available_count,0) AS available_count," +
      "(SELECT COUNT(*) FROM reseller_sales s WHERE s.reseller_id=r.id) AS total_sales," +
      "(SELECT COUNT(*) FROM reseller_code_grants g WHERE g.reseller_id=r.id AND g.status='issued') AS issued_codes " +
      "FROM resellers r LEFT JOIN reseller_code_allocation a ON a.reseller_id=r.id " +
      "ORDER BY r.id DESC LIMIT 100"
    ).all();
    return reply({ environment: 'staging', resellers: rows.results || [] });
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}

export async function onRequestPost(context) {
  const auth = await requireStagingAdmin(context, { write: true });
  if (auth.response) return auth.response;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const email = normalizeEmail(body?.email);
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const commission = body?.commission_percent;
  if (!name || name.length > 120 || /[\u0000-\u001f]/.test(name) || !email ||
      phone.length > 40 || phone && !/^\+?[0-9 ()-]{7,40}$/.test(phone) ||
      !Number.isFinite(commission) || commission < 0 || commission > 100 ||
      !validPassword(body?.password) ||
      !body || Object.keys(body).some(key => !['name','email','phone','commission_percent','password'].includes(key))) {
    return reply({ error: 'Invalid reseller details' }, 400);
  }
  try {
    const passwordHash = await hashPassword(body.password, context.env.WORLDTV_RESELLER_PASSWORD_PEPPER);
    const results = await context.env.DB.batch([
      context.env.DB.prepare(
        "INSERT INTO resellers(name,email,password_hash,phone,commission_percent,status) " +
        "VALUES(?,?,?,?,?,'active')"
      ).bind(name, email, passwordHash, phone || null, commission),
      context.env.DB.prepare(
        "INSERT INTO reseller_code_allocation(reseller_id,allocated_count,used_count,available_count) " +
        "SELECT id,0,0,0 FROM resellers WHERE email=? COLLATE NOCASE"
      ).bind(email),
      context.env.DB.prepare(
        "INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata_json) " +
        "VALUES(?,'staging_reseller_created','reseller',?,?)"
      ).bind(auth.account.id, email, JSON.stringify({ commission_percent: commission }))
    ]);
    if (results?.[0]?.meta?.changes !== 1 || results?.[1]?.meta?.changes !== 1) {
      return reply({ error: 'Could not create reseller' }, 503);
    }
    return reply({ status: 'created', environment: 'staging' }, 201);
  } catch (error) {
    return /UNIQUE constraint failed/i.test(String(error?.message || '')) ?
      reply({ error: 'Could not create reseller' }, 409) :
      reply({ error: 'Service unavailable' }, 503);
  }
}
