import { normalizeEmail } from './staging-auth.js';

const encoder = new TextEncoder();

async function hmac(value, secret, namespace) {
  if (typeof secret !== 'string' || secret.length < 32 ||
      typeof value !== 'string' || !value.length) throw new Error('continuity unavailable');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key,
    encoder.encode(namespace + ':' + value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function continuityEmailHash(email, secret) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('invalid email');
  return hmac(normalized, secret, 'worldtv-continuity-email-v1');
}

export async function continuityRecordDigest(recordId, secret) {
  if (typeof recordId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(recordId)) {
    throw new Error('invalid source record');
  }
  return hmac(recordId, secret, 'worldtv-continuity-railway-record-v1');
}

export function continuityEnd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const date = new Date(value);
  const now = Date.now();
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now ||
      date.getTime() > now + 5 * 366 * 24 * 60 * 60 * 1000) return null;
  return value.slice(0, 19).replace('T', ' ');
}
