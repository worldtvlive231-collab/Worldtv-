import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as info } from '../functions/api/staging/app/info.js';
import { onRequestGet as download } from '../functions/api/staging/app/download.js';
import { parseRange } from '../functions/_lib/staging-apk.js';

const HOST = 'https://worldtv-preview.pages.dev';
const bytes = new TextEncoder().encode('test-apk-bytes');
function setup(overrides = {}) {
  const bucket = {
    head: async key => key === 'apk/worldtv-8.2.8.apk' ? { size: bytes.length, etag: 'verified-etag',
      customMetadata: { sha256: 'a'.repeat(64), version: '8.2.8' } } : null,
    get: async (key, options) => {
      if (key !== 'apk/worldtv-8.2.8.apk') return null;
      const range = options?.range;
      return { size: bytes.length, etag: 'verified-etag',
        customMetadata: { sha256: 'a'.repeat(64), version: '8.2.8' },
        body: range ? bytes.slice(range.offset, range.offset + range.length) : bytes };
    }
  };
  return { WORLDTV_STAGING_DOWNLOAD_ENABLED: 'true', WORLDTV_APK_BUCKET: bucket,
    WORLDTV_APK_OBJECT_KEY: 'apk/worldtv-8.2.8.apk', WORLDTV_APK_VERSION: '8.2.8',
    WORLDTV_APK_SHA256: 'a'.repeat(64), ...overrides };
}

test('APK endpoints are preview-only and disabled by default', async () => {
  assert.equal((await info({ request: new Request(HOST + '/api/staging/app/info'), env: {} })).status, 404);
  assert.equal((await download({ request: new Request('https://myworldtvlive.com/api/staging/app/download'),
    env: setup() })).status, 404);
});

test('APK metadata and complete download expose verified staging headers', async () => {
  const metadata = await info({ request: new Request(HOST + '/api/staging/app/info'), env: setup() });
  assert.equal(metadata.status, 200);
  assert.deepEqual(await metadata.json(), { environment: 'staging', app: 'WORLD TV',
    version: '8.2.8', size_bytes: bytes.length, sha256: 'a'.repeat(64),
    download_url: '/api/staging/app/download' });
  const response = await download({ request: new Request(HOST + '/api/staging/app/download'), env: setup() });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/vnd.android.package-archive');
  assert.equal(response.headers.get('content-length'), String(bytes.length));
  assert.equal(response.headers.get('x-worldtv-sha256'), 'a'.repeat(64));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('APK download supports one bounded byte range and rejects invalid ranges', async () => {
  const response = await download({ request: new Request(HOST + '/api/staging/app/download', {
    headers: { range: 'bytes=2-5' } }), env: setup() });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 2-5/${bytes.length}`);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes.slice(2, 6));
  const invalid = await download({ request: new Request(HOST + '/api/staging/app/download', {
    headers: { range: 'bytes=999-1000' } }), env: setup() });
  assert.equal(invalid.status, 416);
  assert.equal(parseRange('bytes=0-', bytes.length).length, bytes.length);
  assert.equal(parseRange('bytes=-4', bytes.length), false);
});

test('APK endpoints fail closed on unsafe metadata or missing object', async () => {
  const unsafe = setup({ WORLDTV_APK_OBJECT_KEY: '../secret.apk' });
  assert.equal((await info({ request: new Request(HOST + '/api/staging/app/info'), env: unsafe })).status, 503);
  const missing = setup({ WORLDTV_APK_OBJECT_KEY: 'apk/worldtv-missing.apk' });
  assert.equal((await download({ request: new Request(HOST + '/api/staging/app/download'), env: missing })).status, 503);
  const mismatch = setup();
  mismatch.WORLDTV_APK_BUCKET = { ...mismatch.WORLDTV_APK_BUCKET,
    head: async () => ({ size: bytes.length,
      customMetadata: { sha256: 'b'.repeat(64), version: '8.2.8' } }) };
  assert.equal((await download({ request: new Request(HOST + '/api/staging/app/download'),
    env: mismatch })).status, 503);
});

test('APK streaming rejects replacement or metadata changes after HEAD', async () => {
  for (const altered of [
    { etag: 'replaced-object-etag' },
    { size: bytes.length + 1 },
    { customMetadata: { sha256: 'b'.repeat(64), version: '8.2.8' } }
  ]) {
    const env = setup();
    const originalGet = env.WORLDTV_APK_BUCKET.get;
    env.WORLDTV_APK_BUCKET = {
      ...env.WORLDTV_APK_BUCKET,
      get: async (...args) => ({ ...(await originalGet(...args)), ...altered })
    };
    const response = await download({
      request: new Request(HOST + '/api/staging/app/download'), env
    });
    assert.equal(response.status, 503);
  }
});
