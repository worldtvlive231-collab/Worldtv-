/** Account-bound Paystack TEST checkout initialization. Disabled by default. */
import { gate, readBody, reply } from '../../../_lib/staging-auth.js';
import { stagingCustomer } from '../../../_lib/staging-entitlements.js';
import { initializePaystackSandbox, validPaystackTestSecret } from '../../../_lib/staging-paystack-client.js';

const REFERENCE = /^WTVTEST-[A-Za-z0-9_-]{16,32}$/;

export async function onRequestPost(context) {
  const blocked = gate(context, { write: true });
  if (blocked) return blocked;
  if (context.env?.WORLDTV_STAGING_TEST_CHECKOUT_ENABLED !== 'true' ||
      context.env?.WORLDTV_STAGING_PAYSTACK_INITIALIZE_ENABLED !== 'true') {
    return reply({ error: 'Not found' }, 404);
  }
  if (!validPaystackTestSecret(context.env?.WORLDTV_PAYSTACK_TEST_SECRET)) {
    return reply({ error: 'Service unavailable' }, 503);
  }
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (!body || !REFERENCE.test(body.reference || '') || Object.keys(body).length !== 1) {
    return reply({ error: 'Invalid reference' }, 400);
  }

  try {
    const customer = await stagingCustomer(context);
    if (!customer) return reply({ error: 'Not authenticated' }, 401);
    const checkout = await context.env.DB.prepare(
      "SELECT co.id,co.reference,co.amount_minor,co.currency,co.status,o.status AS order_status " +
      "FROM checkout_requests co JOIN orders o ON o.checkout_request_id=co.id " +
      "AND o.reference=co.reference AND o.user_id=co.user_id AND o.plan_id=co.plan_id " +
      "AND o.provider=co.provider AND o.amount_minor=co.amount_minor AND o.currency=co.currency " +
      "JOIN plans p ON p.id=co.plan_id AND p.active=1 " +
      "WHERE co.reference=? AND co.user_id=? AND co.provider='paystack' LIMIT 1"
    ).bind(body.reference, customer.id).first();
    if (!checkout || checkout.status !== 'pending' || checkout.order_status !== 'pending') {
      return reply({ error: 'Checkout unavailable' }, 404);
    }

    const claim = await context.env.DB.prepare(
      "INSERT INTO payment_initializations(checkout_request_id,provider,reference,status,attempts) " +
      "VALUES(?,'paystack',?,'initializing',1) " +
      "ON CONFLICT(checkout_request_id) DO UPDATE SET status='initializing',attempts=attempts+1," +
      "last_error_code=NULL,updated_at=CURRENT_TIMESTAMP " +
      "WHERE payment_initializations.status='failed' " +
      "AND payment_initializations.next_attempt_at<=CURRENT_TIMESTAMP RETURNING id"
    ).bind(checkout.id, checkout.reference).first();

    if (!claim) {
      const existing = await context.env.DB.prepare(
        'SELECT status,authorization_url FROM payment_initializations WHERE checkout_request_id=? LIMIT 1'
      ).bind(checkout.id).first();
      if (existing?.status === 'initialized' && existing.authorization_url) {
        return reply({ environment: 'staging', reference: checkout.reference,
          payment_url: existing.authorization_url, status: 'sandbox_initialized', duplicate: true });
      }
      return reply({ error: 'Checkout initialization in progress' }, 409, { 'retry-after': '60' });
    }

    try {
      const initialized = await initializePaystackSandbox({
        secret: context.env.WORLDTV_PAYSTACK_TEST_SECRET,
        email: customer.email,
        reference: checkout.reference,
        amountMinor: checkout.amount_minor,
        currency: checkout.currency,
        callbackUrl: 'https://worldtv-preview.pages.dev/staging-lab?payment=return',
        fetchImpl: context.data?.paystackFetch || fetch
      });
      const updated = await context.env.DB.prepare(
        "UPDATE payment_initializations SET status='initialized',authorization_url=?," +
        "provider_access_code=?,initialized_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP " +
        "WHERE id=? AND status='initializing'"
      ).bind(initialized.payment_url, initialized.access_code, claim.id).run();
      if (updated?.meta?.changes !== 1) throw new Error('initialization state changed');
      return reply({ environment: 'staging', reference: checkout.reference,
        payment_url: initialized.payment_url, status: 'sandbox_initialized' });
    } catch {
      await context.env.DB.prepare(
        "UPDATE payment_initializations SET status='failed',authorization_url=NULL," +
        "provider_access_code=NULL,last_error_code='provider_rejected'," +
        "next_attempt_at=datetime('now','+1 minute'),updated_at=CURRENT_TIMESTAMP " +
        "WHERE id=? AND status='initializing'"
      ).bind(claim.id).run();
      return reply({ error: 'Could not start sandbox payment' }, 502, { 'retry-after': '60' });
    }
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
