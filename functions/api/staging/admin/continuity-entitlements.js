import { makeSessionToken, readBody, reply } from '../../../_lib/staging-auth.js';
import { requireStagingAdmin } from '../../../_lib/staging-admin-access.js';
import {
  continuityEmailHash, continuityRecordDigest, continuityEnd
} from '../../../_lib/staging-continuity.js';

export async function onRequestGet(context) {
  const auth = await requireStagingAdmin(context);
  if (auth.response) return auth.response;
  if (context.env?.WORLDTV_STAGING_CONTINUITY_ADMIN_ENABLED !== 'true') {
    return reply({ error: 'Not found' }, 404);
  }
  try {
    const rows = await context.env.DB.prepare(
      "SELECT id,substr(source_record_digest,1,12) AS source_hint," +
      "substr(email_hash,1,12) AS email_hint,plan_slug,source_ends_at,status,claimed_at " +
      "FROM continuity_entitlements ORDER BY id DESC LIMIT 100"
    ).all();
    return reply({ environment: 'staging', entitlements: rows.results || [] });
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}

export async function onRequestPost(context) {
  const auth = await requireStagingAdmin(context, { write: true });
  if (auth.response) return auth.response;
  if (context.env?.WORLDTV_STAGING_CONTINUITY_ADMIN_ENABLED !== 'true') {
    return reply({ error: 'Not found' }, 404);
  }
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (!Array.isArray(body?.entries) || body.entries.length < 1 || body.entries.length > 50 ||
      Object.keys(body).length !== 1 ||
      typeof context.env?.WORLDTV_CONTINUITY_HMAC_SECRET !== 'string' ||
      context.env.WORLDTV_CONTINUITY_HMAC_SECRET.length < 32) {
    return reply({ error: 'Invalid continuity batch' }, 400);
  }
  try {
    const normalized = [];
    const records = new Set();
    for (const entry of body.entries) {
      if (!entry || Object.keys(entry).some(key =>
        !['source_record_id','email','plan_slug','ends_at'].includes(key)) ||
        entry.plan_slug !== 'annual') throw new Error('invalid entry');
      const endsAt = continuityEnd(entry.ends_at);
      if (!endsAt) throw new Error('invalid expiry');
      const recordDigest = await continuityRecordDigest(entry.source_record_id,
        context.env.WORLDTV_CONTINUITY_HMAC_SECRET);
      if (records.has(recordDigest)) throw new Error('duplicate source record');
      records.add(recordDigest);
      normalized.push({ endsAt,
        emailHash: await continuityEmailHash(entry.email, context.env.WORLDTV_CONTINUITY_HMAC_SECRET),
        recordDigest });
    }
    const batchReference = 'WTVCB-' + makeSessionToken().slice(0, 24);
    const statements = [context.env.DB.prepare(
      'INSERT INTO continuity_import_batches(batch_reference,actor_user_id,entry_count) VALUES(?,?,?)'
    ).bind(batchReference, auth.account.id, normalized.length)];
    for (const entry of normalized) {
      statements.push(context.env.DB.prepare(
        "INSERT INTO continuity_entitlements(batch_id,source_record_digest,email_hash,plan_slug,source_ends_at,status) " +
        "SELECT id,?,?,'annual',?,'eligible' FROM continuity_import_batches WHERE batch_reference=?"
      ).bind(entry.recordDigest, entry.emailHash, entry.endsAt, batchReference));
    }
    statements.push(context.env.DB.prepare(
      "INSERT INTO audit_logs(actor_user_id,action,target_type,target_id,metadata_json) " +
      "VALUES(?,'staging_continuity_import','continuity_batch',?,?)"
    ).bind(auth.account.id, batchReference, JSON.stringify({ entries: normalized.length })));
    const results = await context.env.DB.batch(statements);
    if (results?.[0]?.meta?.changes !== 1 ||
        results.slice(1, 1 + normalized.length).some(result => result?.meta?.changes !== 1)) {
      return reply({ error: 'Continuity batch rejected' }, 409);
    }
    return reply({ environment: 'staging', status: 'staged',
      batch_reference: batchReference, entries: normalized.length }, 201);
  } catch (error) {
    return /UNIQUE constraint failed/i.test(String(error?.message || '')) ?
      reply({ error: 'Continuity record already staged' }, 409) :
      reply({ error: 'Invalid continuity batch' }, 400);
  }
}
