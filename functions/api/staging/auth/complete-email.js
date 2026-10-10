import { gate, readBody, validPassword, hashPassword, reply, clearSessionCookie } from '../../../_lib/staging-auth.js';
import { limitAuth, consumeIdentityToken } from '../../../_lib/staging-account-security.js';

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;
  if (context.env.WORLDTV_STAGING_IDENTITY_ENABLED !== 'true') return reply({ error: 'Not found' }, 404);
  const limited = await limitAuth(context, 'complete-email');
  if (limited) return limited;
  let input;
  try { input = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (!['verify','reset'].includes(input?.purpose) || typeof input?.token !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.token) || input.purpose === 'reset' && !validPassword(input.password)) {
    return reply({ error: 'Invalid request' }, 400);
  }
  try {
    const passwordHash = input.purpose === 'reset' ?
      await hashPassword(input.password, context.env.WORLDTV_PASSWORD_PEPPER) : undefined;
    if (!await consumeIdentityToken(context, input.token, input.purpose, passwordHash)) {
      return reply({ error: 'Invalid or expired link' }, 400);
    }
    return reply({ status: input.purpose === 'verify' ? 'Email verified; sign in' : 'Password changed; sign in' }, 200,
      input.purpose === 'reset' ? { 'set-cookie': clearSessionCookie() } : {});
  } catch { return reply({ error: 'Service unavailable' }, 503); }
}
