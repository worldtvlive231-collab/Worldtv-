import { normalizeEmail, validPassword, verifyPassword, hashSessionToken, reply } from '../../../_lib/staging-auth.js';
import { limitAuth } from '../../../_lib/staging-account-security.js';
import {
  resellerGate, readBody, newResellerSession, resellerCookie, resellerExpiryDate
} from '../../../_lib/staging-reseller.js';

export async function onRequestPost(context) {
  const blocked = resellerGate(context, { write: true });
  if (blocked) return blocked;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  const email = normalizeEmail(body?.email);
  if (!email || !validPassword(body?.password)) return reply({ error: 'Invalid email or password' }, 401);
  const limited = await limitAuth(context, 'reseller-login', email);
  if (limited) return limited;
  try {
    const reseller = await context.env.DB.prepare(
      "SELECT id,password_hash,status FROM resellers WHERE email=? COLLATE NOCASE LIMIT 1"
    ).bind(email).first();
    const valid = await verifyPassword(body.password, reseller?.password_hash ||
      'pbkdf2_sha256_pepper$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      context.env.WORLDTV_RESELLER_PASSWORD_PEPPER);
    if (!reseller || reseller.status !== 'active' || !valid) {
      return reply({ error: 'Invalid email or password' }, 401);
    }
    const token = newResellerSession();
    await context.env.DB.prepare(
      'INSERT INTO reseller_sessions(token_hash,reseller_id,expires_at) VALUES(?,?,?)'
    ).bind(await hashSessionToken(token), reseller.id, resellerExpiryDate()).run();
    return reply({ status: 'authenticated', environment: 'staging' }, 200,
      { 'set-cookie': resellerCookie(token) });
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
