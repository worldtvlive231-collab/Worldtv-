import { makeSessionToken, reply } from '../../../_lib/staging-auth.js';
import { resellerGate, readBody, stagingReseller } from '../../../_lib/staging-reseller.js';
import { derivedResellerCode } from '../../../_lib/staging-issuance.js';

export async function onRequestPost(context) {
  const blocked = resellerGate(context, { write: true });
  if (blocked) return blocked;
  if (context.env?.WORLDTV_STAGING_RESELLER_CODES_ENABLED !== 'true') {
    return reply({ error: 'Not found' }, 404);
  }
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (!Number.isSafeInteger(body?.count) || body.count < 1 || body.count > 20 ||
      Object.keys(body).length !== 1 ||
      typeof context.env?.WORLDTV_RESELLER_CODE_HMAC_SECRET !== 'string' ||
      context.env.WORLDTV_RESELLER_CODE_HMAC_SECRET.length < 32) {
    return reply({ error: 'Invalid generation request' }, 400);
  }
  try {
    const reseller = await stagingReseller(context);
    if (!reseller) return reply({ error: 'Not authenticated' }, 401);
    const batchReference = 'WTVRB-' + makeSessionToken().slice(0, 24);
    const grants = [];
    for (let index = 0; index < body.count; index++) {
      const grantReference = 'WTVRG-' + makeSessionToken().slice(0, 24);
      grants.push({ grant_reference: grantReference,
        ...(await derivedResellerCode(grantReference, context.env.WORLDTV_RESELLER_CODE_HMAC_SECRET)) });
    }
    const statements = [
      context.env.DB.prepare(
        "INSERT INTO reseller_generation_batches(batch_reference,reseller_id,requested_count) " +
        "SELECT ?,r.id,? FROM resellers r JOIN reseller_code_allocation a ON a.reseller_id=r.id " +
        "WHERE r.id=? AND r.status='active' AND a.available_count>=?"
      ).bind(batchReference, body.count, reseller.id, body.count),
      context.env.DB.prepare(
        "UPDATE reseller_code_allocation SET available_count=available_count-?,updated_at=CURRENT_TIMESTAMP " +
        "WHERE reseller_id=? AND EXISTS(SELECT 1 FROM reseller_generation_batches " +
        "WHERE batch_reference=? AND reseller_id=?)"
      ).bind(body.count, reseller.id, batchReference, reseller.id)
    ];
    for (const grant of grants) {
      statements.push(context.env.DB.prepare(
        "INSERT INTO subscription_codes(code_hash,code_hint,plan_id,status) " +
        "SELECT ?,?,p.id,'unused' FROM plans p JOIN reseller_generation_batches b " +
        "ON b.batch_reference=? AND b.reseller_id=? WHERE p.slug='annual' AND p.active=1"
      ).bind(grant.code_hash, grant.code_hint, batchReference, reseller.id));
      statements.push(context.env.DB.prepare(
        "INSERT INTO reseller_code_grants(grant_reference,batch_id,reseller_id,subscription_code_id,status) " +
        "SELECT ?,b.id,b.reseller_id,c.id,'issued' FROM reseller_generation_batches b " +
        "JOIN subscription_codes c ON c.code_hash=? " +
        "WHERE b.batch_reference=? AND b.reseller_id=?"
      ).bind(grant.grant_reference, grant.code_hash, batchReference, reseller.id));
    }
    statements.push(context.env.DB.prepare(
      "INSERT INTO audit_logs(action,target_type,target_id,metadata_json) " +
      "SELECT 'staging_reseller_codes_generated','reseller',CAST(reseller_id AS TEXT),? " +
      "FROM reseller_generation_batches WHERE batch_reference=?"
    ).bind(JSON.stringify({ count: body.count, batch_reference: batchReference }), batchReference));
    const results = await context.env.DB.batch(statements);
    if (results?.[0]?.meta?.changes !== 1 || results?.[1]?.meta?.changes !== 1 ||
        results.slice(2, 2 + body.count * 2).some(result => result?.meta?.changes !== 1)) {
      return reply({ error: 'Insufficient allocation' }, 409);
    }
    return reply({ environment: 'staging', batch_reference: batchReference,
      codes: grants.map(({ grant_reference, code, code_hint }) => ({ grant_reference, code, code_hint })),
      warning: 'TEST CODES — shown once; store them securely' }, 201);
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
