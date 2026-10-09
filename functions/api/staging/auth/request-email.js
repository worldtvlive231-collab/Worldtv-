import { gate, readBody, normalizeEmail, reply } from '../../../_lib/staging-auth.js';
import { limitAuth, mailReady, allowedRecipient, deliverIdentityToken } from '../../../_lib/staging-account-security.js';

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;
  if (context.env.WORLDTV_STAGING_IDENTITY_ENABLED !== 'true') return reply({ error: 'Not found' }, 404);
  let input;
  try { input = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  const email = normalizeEmail(input?.email);
  const purpose = input?.purpose;
  if (!email || !['verify','reset'].includes(purpose)) return reply({ error: 'Invalid request' }, 400);
  const limited = await limitAuth(context, 'request-email', email);
  if (limited) return limited;
  if (!mailReady(context)) return reply({ error: 'Service unavailable' }, 503);
  try {
    const user = await context.env.DB.prepare("SELECT id,email,email_verified_at FROM users WHERE email=? COLLATE NOCASE AND status='active' AND role='customer'")
      .bind(email).first();
    if (user && allowedRecipient(context, email) && (purpose === 'verify' ? !user.email_verified_at : user.email_verified_at)) {
      try { await deliverIdentityToken(context, user, purpose); }
      catch { /* Same public result prevents account enumeration. Operations must monitor mailer failures. */ }
    }
    return reply({ status: 'If eligible, an email will be sent' }, 202);
  } catch { return reply({ error: 'Service unavailable' }, 503); }
}
