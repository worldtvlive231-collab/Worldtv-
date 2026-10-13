const HOST = 'worldtv-preview.pages.dev';
const MAX_APK_BYTES = 500 * 1024 * 1024;

export function apkGate(context) {
  const url = new URL(context.request.url);
  return url.hostname === HOST && context.env?.WORLDTV_STAGING_DOWNLOAD_ENABLED === 'true' &&
    typeof context.env?.WORLDTV_APK_BUCKET?.head === 'function' &&
    typeof context.env?.WORLDTV_APK_BUCKET?.get === 'function';
}

export function apkConfig(env) {
  const key = env?.WORLDTV_APK_OBJECT_KEY;
  const version = env?.WORLDTV_APK_VERSION;
  const sha256 = env?.WORLDTV_APK_SHA256;
  if (typeof key !== 'string' || !/^apk\/worldtv-[A-Za-z0-9._-]{1,100}\.apk$/.test(key) ||
      typeof version !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(version) ||
      typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return { key, version, sha256, filename: key.split('/').at(-1) };
}

export function validApkHead(head, config) {
  return head && Number.isSafeInteger(head.size) && head.size > 0 && head.size <= MAX_APK_BYTES &&
    config && head.customMetadata?.sha256 === config.sha256 &&
    head.customMetadata?.version === config.version;
}

export function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match) return false;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || start >= size || end >= size) return false;
  return { offset: start, length: end - start + 1, end };
}
