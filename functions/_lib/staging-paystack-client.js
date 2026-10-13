/** Paystack TEST-mode initialization client. It rejects live keys and URLs. */

const INITIALIZE_URL = 'https://api.paystack.co/transaction/initialize';
const PREVIEW_ORIGIN = 'https://worldtv-preview.pages.dev';

export function validPaystackTestSecret(secret) {
  return typeof secret === 'string' && /^sk_test_[A-Za-z0-9._-]{16,200}$/.test(secret);
}

function validReference(reference) {
  return typeof reference === 'string' && /^WTVTEST-[A-Za-z0-9_-]{16,32}$/.test(reference);
}

function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validCallback(callbackUrl) {
  try {
    const url = new URL(callbackUrl);
    return url.origin === PREVIEW_ORIGIN && url.pathname === '/staging-lab' &&
      !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function approvedCheckoutUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.paystack.com' ||
        url.username || url.password || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function initializePaystackSandbox({
  secret, email, reference, amountMinor, currency, callbackUrl, fetchImpl = fetch
}) {
  if (!validPaystackTestSecret(secret) || !validEmail(email) || !validReference(reference) ||
      !Number.isSafeInteger(amountMinor) || amountMinor <= 0 ||
      !/^[A-Z]{3}$/.test(currency || '') || !validCallback(callbackUrl) ||
      typeof fetchImpl !== 'function') {
    throw new Error('invalid sandbox payment configuration');
  }

  const response = await fetchImpl(INITIALIZE_URL, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + secret,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      email,
      amount: String(amountMinor),
      currency,
      reference,
      callback_url: callbackUrl,
      metadata: { environment: 'staging', product: 'worldtv-annual' }
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(8000)
  });

  let payload;
  try { payload = await response.json(); }
  catch { throw new Error('sandbox provider response invalid'); }
  const paymentUrl = approvedCheckoutUrl(payload?.data?.authorization_url);
  const accessCode = payload?.data?.access_code;
  const returnedReference = payload?.data?.reference;
  if (!response.ok || payload?.status !== true || !paymentUrl ||
      typeof accessCode !== 'string' || !/^[A-Za-z0-9._-]{8,200}$/.test(accessCode) ||
      returnedReference !== reference) {
    throw new Error('sandbox provider rejected initialization');
  }
  return { payment_url: paymentUrl, access_code: accessCode };
}
