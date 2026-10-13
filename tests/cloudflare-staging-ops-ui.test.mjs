import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { onRequestGet as adminPanel } from '../functions/staging-admin.js';
import { onRequestGet as resellerPanel } from '../functions/staging-reseller.js';
import { onRequestGet as downloadPanel } from '../functions/staging-download.js';

const HOST = 'https://worldtv-preview.pages.dev';
const source = path => readFileSync(path, 'utf8');

test('admin and reseller panels remain disabled without their independent gates', async () => {
  const admin = await adminPanel({
    request: new Request(HOST + '/staging-admin'),
    env: { WORLDTV_STAGING_ADMIN_UI_ENABLED: 'true', WORLDTV_STAGING_ADMIN_ENABLED: 'false' }
  });
  assert.equal(admin.status, 404);
  const reseller = await resellerPanel({
    request: new Request(HOST + '/staging-reseller'),
    env: { WORLDTV_STAGING_RESELLER_UI_ENABLED: 'true', WORLDTV_STAGING_RESELLER_ENABLED: 'false' }
  });
  assert.equal(reseller.status, 404);
});

test('staging admin interface exposes chat queue, read, reply and close through existing protected APIs', () => {
  const html = source('functions/staging-admin.js');
  for (const form of ['thread', 'reply', 'close-chat']) {
    assert.ok(html.includes('id="' + form + '"'), form);
  }
  for (const api of ['/api/staging/admin/chats', '/api/staging/admin/chat-messages',
                     '/api/staging/admin/chat-reply', '/api/staging/admin/chat-close']) {
    // chats endpoint is built dynamically using the data-get selector.
    if (api.endsWith('/chats')) assert.match(html, /data-get="chats"/);
    else assert.ok(html.includes(api), api);
  }
  assert.match(html, /Number\.isSafeInteger\(id\)/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /\.innerHTML\s*=/);
  const script = html.match(/<script nonce="__NONCE__">([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script[1]));
});

test('staging reseller interface shows quota and clears password and codes on logout', () => {
  const html = source('functions/staging-reseller.js');
  assert.match(html, /id="quota"/);
  assert.match(html, /querySelector\('input\[name=password\]'\)\.value=''/);
  assert.match(html, /Previously displayed codes cleared from this page/);
  assert.match(html, /textContent='Allocated:/);
  const script = html.match(/<script nonce="__NONCE__">([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(() => new Script(script[1]));
});

test('staging APK landing page keeps download hidden until R2 verification is configured', async () => {
  const blocked = await downloadPanel({ request: new Request(HOST + '/staging-download'), env: {} });
  assert.equal(blocked.status, 404);
  const page = await downloadPanel({
    request: new Request(HOST + '/staging-download'),
    env: { WORLDTV_STAGING_UI_ENABLED: 'true' }
  });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /not yet been placed in Cloudflare storage/);
  assert.doesNotMatch(html, /href="\/api\/staging\/app\/download"/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
