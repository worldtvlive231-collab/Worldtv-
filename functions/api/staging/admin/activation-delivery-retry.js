import { readBody, reply } from '../../../_lib/staging-auth.js';
import { requireStagingAdmin } from '../../../_lib/staging-admin-access.js';
import { attemptActivationDelivery } from '../../../_lib/staging-delivery.js';

export async function onRequestPost(context) {
  const auth = await requireStagingAdmin(context, { write: true });
  if (auth.response) return auth.response;
  let body;
  try { body = await readBody(context.request); }
  catch { return reply({ error: 'Invalid request' }, 400); }
  if (!Number.isSafeInteger(body?.order_id) || body.order_id <= 0 || Object.keys(body).length !== 1) {
    return reply({ error: 'Invalid order' }, 400);
  }
  try {
    const result = await attemptActivationDelivery(context, body.order_id);
    return ['delivered','retry','dead'].includes(result.status) ?
      reply({ environment: 'staging', delivery: result.status }) :
      reply({ error: 'Delivery unavailable', delivery: result.status }, 409);
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
