import { reply, readBody, hashSessionToken, makeSessionToken } from './staging-auth.js';

const HOST = 'worldtv-preview.pages.dev';
const COOKIE = '__Host-worldtv_reseller';
const MAX_AGE = 60 * 60 * 24;

export function resellerGate(context, { write = false } = {}) {
  const url = new URL(context.request.url);
  if (url.hostname !== HOST || context.env?.WORLDTV_STAGING_RESELLER_ENABLED !== 'true') {
    return reply({ error: 'Not found' }, 404);
  }
  if (!context.env?.DB || typeof context.env.DB.prepare !== 'function') {
    return reply({ error: 'Service unavailable' }, 503);
  }
  if (write) {
    if (context.request.headers.get('origin') !== url.origin) {
      return reply({ error: 'Origin not allowed' }, 403);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(context.request.headers.get('content-type') || '')) {
      return reply({ error: 'Expected JSON' }, 415);
    }
  }
  return null;
}

export function resellerToken(request) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE) {
      const token = rest.join('=');
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
    }
  }
  return null;
}

export async function stagingReseller(context) {
  const token = resellerToken(context.request);
  if (!token) return null;
  return context.env.DB.prepare(
    "SELECT r.id,r.name,r.email,r.phone,r.commission_percent FROM reseller_sessions s " +
    "JOIN resellers r ON r.id=s.reseller_id WHERE s.token_hash=? " +
    "AND s.expires_at>CURRENT_TIMESTAMP AND r.status='active' LIMIT 1"
  ).bind(await hashSessionToken(token)).first();
}

export function resellerCookie(token) {
  return `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; Secure; HttpOnly; SameSite=Strict`;
}

export function clearResellerCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

export function newResellerSession() {
  return makeSessionToken();
}

export function resellerExpiryDate() {
  return new Date(Date.now() + MAX_AGE * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
}

export { readBody };
