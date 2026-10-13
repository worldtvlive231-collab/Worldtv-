/** Durable staging activation-code delivery from a D1 outbox. */
import { allowedRecipient } from './staging-account-security.js';
import { derivedActivationCode } from './staging-issuance.js';

function deliveryReady(context) {
  return context.env?.WORLDTV_STAGING_DELIVERY_ENABLED === 'true' &&
    typeof context.env?.WORLDTV_ACTIVATION_MAILER?.fetch === 'function' &&
    typeof context.env?.WORLDTV_STAGING_CODE_HMAC_SECRET === 'string' &&
    context.env.WORLDTV_STAGING_CODE_HMAC_SECRET.length >= 32;
}

async function release(context, delivery, status, errorCode = null) {
  const next = status === 'retry' ? ",next_attempt_at=datetime('now','+5 minutes')" : '';
  await context.env.DB.prepare(
    `UPDATE activation_deliveries SET status=?,last_error_code=?,claim_token=NULL,claimed_at=NULL,` +
    `updated_at=CURRENT_TIMESTAMP${next} WHERE id=? AND claim_token=?`
  ).bind(status, errorCode, delivery.id, delivery.claim_token).run();
}

export async function attemptActivationDelivery(context, orderId) {
  if (!deliveryReady(context) || !Number.isSafeInteger(orderId) || orderId <= 0) {
    return { status: 'disabled' };
  }
  const claimToken = crypto.randomUUID();
  const delivery = await context.env.DB.prepare(
    "UPDATE activation_deliveries SET status='delivering',attempts=attempts+1,claim_token=?," +
    "claimed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=? AND " +
    "((status IN ('pending','retry') AND next_attempt_at<=CURRENT_TIMESTAMP) OR " +
    "(status='delivering' AND claimed_at<datetime('now','-10 minutes'))) " +
    "RETURNING id,attempts,claim_token"
  ).bind(claimToken, orderId).first();
  if (!delivery) return { status: 'not_due' };

  try {
    const row = await context.env.DB.prepare(
      "SELECT o.reference,u.email,sc.code_hash,sc.status AS code_status " +
      "FROM activation_deliveries d JOIN orders o ON o.id=d.order_id AND o.status='paid' " +
      "JOIN users u ON u.id=d.user_id AND u.id=o.user_id AND u.status='active' " +
      "AND u.role='customer' AND u.email_verified_at IS NOT NULL " +
      "JOIN subscription_codes sc ON sc.order_id=o.id AND sc.user_id=o.user_id " +
      "WHERE d.id=? AND d.claim_token=? LIMIT 1"
    ).bind(delivery.id, claimToken).first();
    if (!row || row.code_status !== 'unused' || !allowedRecipient(context, row.email)) {
      await release(context, delivery, 'dead', 'recipient_ineligible');
      return { status: 'dead' };
    }
    const derived = await derivedActivationCode(
      row.reference, context.env.WORLDTV_STAGING_CODE_HMAC_SECRET
    );
    if (derived.code_hash !== row.code_hash) {
      await release(context, delivery, 'dead', 'code_mismatch');
      return { status: 'dead' };
    }
    const response = await context.env.WORLDTV_ACTIVATION_MAILER.fetch(
      new Request('https://activation-mailer.internal/send', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: row.email, template: 'activation-code',
          order_reference: row.reference, activation_code: derived.code,
          environment: 'staging' }), signal: AbortSignal.timeout(5000)
      })
    );
    if (!response.ok) throw new Error('mailer rejected');
    const done = await context.env.DB.prepare(
      "UPDATE activation_deliveries SET status='delivered',delivered_at=CURRENT_TIMESTAMP," +
      "last_error_code=NULL,claim_token=NULL,claimed_at=NULL,updated_at=CURRENT_TIMESTAMP " +
      "WHERE id=? AND claim_token=?"
    ).bind(delivery.id, claimToken).run();
    return { status: done?.meta?.changes === 1 ? 'delivered' : 'not_due' };
  } catch {
    await release(context, delivery, delivery.attempts >= 5 ? 'dead' : 'retry',
      delivery.attempts >= 5 ? 'attempts_exhausted' : 'mailer_unavailable');
    return { status: delivery.attempts >= 5 ? 'dead' : 'retry' };
  }
}
