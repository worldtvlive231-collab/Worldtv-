import { reply } from '../../../_lib/staging-auth.js';
import { apkGate, apkConfig, validApkHead } from '../../../_lib/staging-apk.js';

export async function onRequestGet(context) {
  if (!apkGate(context)) return reply({ error: 'Not found' }, 404);
  const config = apkConfig(context.env);
  if (!config) return reply({ error: 'Download unavailable' }, 503);
  try {
    const head = await context.env.WORLDTV_APK_BUCKET.head(config.key);
    if (!validApkHead(head, config)) return reply({ error: 'Download unavailable' }, 503);
    return reply({ environment: 'staging', app: 'WORLD TV', version: config.version,
      size_bytes: head.size, sha256: config.sha256,
      download_url: '/api/staging/app/download' });
  } catch {
    return reply({ error: 'Download unavailable' }, 503);
  }
}
