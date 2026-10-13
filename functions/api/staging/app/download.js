import { reply } from '../../../_lib/staging-auth.js';
import { apkGate, apkConfig, validApkHead, parseRange } from '../../../_lib/staging-apk.js';

export async function onRequestGet(context) {
  if (!apkGate(context)) return reply({ error: 'Not found' }, 404);
  const config = apkConfig(context.env);
  if (!config) return reply({ error: 'Download unavailable' }, 503);
  try {
    const head = await context.env.WORLDTV_APK_BUCKET.head(config.key);
    if (!validApkHead(head, config)) return reply({ error: 'Download unavailable' }, 503);
    const range = parseRange(context.request.headers.get('range'), head.size);
    if (range === false) {
      return new Response(null, { status: 416, headers: {
        'content-range': `bytes */${head.size}`, 'cache-control': 'no-store'
      } });
    }
    const object = await context.env.WORLDTV_APK_BUCKET.get(config.key,
      range ? { range: { offset: range.offset, length: range.length } } : {});
    // Recheck the fetched object: a replacement between HEAD and GET must fail closed.
    if (!object?.body || !validApkHead(object, config) ||
        object.size !== head.size ||
        (head.etag && head.etag !== object.etag)) {
      return reply({ error: 'Download unavailable' }, 503);
    }
    const length = range ? range.length : head.size;
    const headers = {
      'content-type': 'application/vnd.android.package-archive',
      'content-disposition': `attachment; filename="${config.filename}"`,
      'content-length': String(length),
      'accept-ranges': 'bytes',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
      'x-worldtv-apk-version': config.version,
      'x-worldtv-sha256': config.sha256
    };
    if (range) headers['content-range'] = `bytes ${range.offset}-${range.end}/${head.size}`;
    return new Response(object.body, { status: range ? 206 : 200, headers });
  } catch {
    return reply({ error: 'Download unavailable' }, 503);
  }
}
