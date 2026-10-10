import { reply, hashSessionToken, makeSessionToken } from './staging-auth.js';

// All instances share D1 counters. Keys use a secret HMAC to protect IP/email data.
export async function limitAuth(context, action, email = '') {
  const secret = context.env.WORLDTV_AUTH_RATE_SECRET;
  const ip = context.request.headers.get('cf-connecting-ip');
  if (typeof secret !== 'string' || secret.length < 32 || !ip ||
      !/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return reply({ error: 'Service unavailable' }, 503);
  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const window = Math.floor(Date.now() / 600000);
    for (const [subject, maximum] of [['ip:' + ip, 20], ...(email ? [['email:' + email, 5]] : [])]) {
      const digest = await crypto.subtle.sign('HMAC', key,
        new TextEncoder().encode(action + ':' + subject));
      const hash = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join('');
      const row = await context.env.DB.prepare(
        'INSERT INTO auth_rate_limits(key_hash,window_start,attempts) VALUES(?,?,1) ' +
        'ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start ' +
        'THEN attempts+1 ELSE 1 END, window_start=excluded.window_start RETURNING attempts'
      ).bind(hash, window).first();
      if (!row || !Number.isInteger(row.attempts)) throw new Error('counter unavailable');
      if (row.attempts > maximum) return reply({ error: 'Try again later' }, 429, { 'retry-after': '600' });
    }
    return null;
  } catch { return reply({ error: 'Service unavailable' }, 503); }
}

export function mailReady(context) {
  // Service binding is supplied by the deployment; no browser-selected provider URL.
  return typeof context.env.WORLDTV_AUTH_MAILER?.fetch === 'function' &&
    typeof context.env.WORLDTV_STAGING_EMAIL_ALLOWLIST === 'string';
}

export function allowedRecipient(context, email) {
  return String(context.env.WORLDTV_STAGING_EMAIL_ALLOWLIST || '')
    .split(',').map(x => x.trim().toLowerCase()).includes(email);
}

export async function deliverIdentityToken(context, user, purpose) {
  if (!mailReady(context) || !allowedRecipient(context, user.email)) throw new Error('mailer unavailable');
  const token = makeSessionToken();
  const hash = await hashSessionToken(token);
  const expires = new Date(Date.now() + (purpose === 'verify' ? 86400000 : 1800000))
    .toISOString().slice(0,19).replace('T',' ');
  await context.env.DB.batch([
    context.env.DB.prepare('DELETE FROM identity_tokens WHERE user_id=? AND purpose=?').bind(user.id, purpose),
    context.env.DB.prepare('INSERT INTO identity_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,?)')
      .bind(hash, user.id, purpose, expires)
  ]);
  const origin = new URL(context.request.url).origin;
  // Fragment keeps bearer secrets out of access logs and HTTP referrers.
  const link = origin + '/staging-account#' + purpose + '=' + token;
  const response = await context.env.WORLDTV_AUTH_MAILER.fetch(new Request('https://auth-mailer.internal/send', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to: user.email, template: purpose, link, environment: 'staging' }),
    signal: AbortSignal.timeout(5000)
  }));
  if (!response.ok) throw new Error('delivery failed');
}

// D1 batch is transactional. The random claim marker ensures only the winning
// request may change the password or verification flag, even under replay/races.
export async function consumeIdentityToken(context, token, purpose, passwordHash) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const hash = await hashSessionToken(token);
  const claim = crypto.randomUUID();
  const claimSQL = 'SELECT user_id FROM identity_tokens WHERE token_hash=? AND used_by=? AND purpose=?';
  const statements = [context.env.DB.prepare(
    "UPDATE identity_tokens SET used_by=? WHERE token_hash=? AND purpose=? AND used_by IS NULL " +
    "AND expires_at>CURRENT_TIMESTAMP AND user_id IN (SELECT id FROM users WHERE status='active' AND role='customer' AND (?='verify' OR email_verified_at IS NOT NULL))"
  ).bind(claim, hash, purpose, purpose)];
  if (purpose === 'verify') {
    statements.push(context.env.DB.prepare('UPDATE users SET email_verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP ' +
      'WHERE id IN (' + claimSQL + ')').bind(hash, claim, purpose));
  } else {
    statements.push(context.env.DB.prepare('UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP ' +
      'WHERE email_verified_at IS NOT NULL AND id IN (' + claimSQL + ')').bind(passwordHash, hash, claim, purpose));
    statements.push(context.env.DB.prepare('DELETE FROM customer_sessions WHERE user_id IN (' + claimSQL + ')')
      .bind(hash, claim, purpose));
    statements.push(context.env.DB.prepare('UPDATE identity_tokens SET used_by=? WHERE used_by IS NULL AND purpose=\'reset\' ' +
      'AND user_id IN (' + claimSQL + ')').bind(claim, hash, claim, purpose));
  }
  const result = await context.env.DB.batch(statements);
  return result[0]?.meta?.changes === 1 && result[1]?.meta?.changes === 1;
}
