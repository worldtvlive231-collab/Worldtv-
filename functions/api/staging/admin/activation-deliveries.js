import { reply } from '../../../_lib/staging-auth.js';
import { requireStagingAdmin } from '../../../_lib/staging-admin-access.js';

export async function onRequestGet(context) {
  const auth = await requireStagingAdmin(context);
  if (auth.response) return auth.response;
  try {
    const rows = await context.env.DB.prepare(
      "SELECT d.order_id,d.status,d.attempts,d.next_attempt_at,d.delivered_at,d.last_error_code," +
      "o.reference,substr(u.email,1,2)||'***@'||substr(u.email,instr(u.email,'@')+1) AS recipient " +
      "FROM activation_deliveries d JOIN orders o ON o.id=d.order_id " +
      "JOIN users u ON u.id=d.user_id ORDER BY d.id DESC LIMIT 100"
    ).all();
    return reply({ environment: 'staging', deliveries: rows.results || [] });
  } catch {
    return reply({ error: 'Service unavailable' }, 503);
  }
}
