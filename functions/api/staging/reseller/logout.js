import { hashSessionToken, reply } from '../../../_lib/staging-auth.js';
import { resellerGate, resellerToken, clearResellerCookie } from '../../../_lib/staging-reseller.js';

export async function onRequestPost(context) {
  const blocked = resellerGate(context, { write: true });
  if (blocked) return blocked;
  try {
    const token = resellerToken(context.request);
    if (token) await context.env.DB.prepare('DELETE FROM reseller_sessions WHERE token_hash=?')
      .bind(await hashSessionToken(token)).run();
    return reply({ status: 'signed_out', environment: 'staging' }, 200,
      { 'set-cookie': clearResellerCookie() });
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
