import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.mjs';
import { onRequestGet as resellerPage } from '../functions/staging-reseller.js';
import { onRequestGet as adminPage } from '../functions/staging-admin.js';

const HOST = 'https://worldtv-preview.pages.dev';

test('reseller dashboard page is gated and uses nonce-only scripts without browser storage', async () => {
  const db = new TestD1();
  assert.equal((await resellerPage({ request: new Request(HOST + '/staging-reseller'),
    env: { DB: db } })).status, 404);
  const response = await resellerPage({ request: new Request(HOST + '/staging-reseller'), env: {
    DB: db, WORLDTV_STAGING_RESELLER_ENABLED: 'true',
    WORLDTV_STAGING_RESELLER_UI_ENABLED: 'true' } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-security-policy'), /script-src 'nonce-[0-9a-f]{32}'/);
  const html = await response.text();
  assert.match(html, /TEST CODES ONLY/);
  assert.match(html, /\/api\/staging\/reseller\/generate-codes/);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
  assert.doesNotMatch(html, /nonce="__NONCE__"/);
});

test('admin dashboard page stays hidden without both UI flag and verified admin identity', async () => {
  const db = new TestD1();
  const hidden = await adminPage({ request: new Request(HOST + '/staging-admin'), env: {
    DB: db, WORLDTV_STAGING_ADMIN_ENABLED: 'true' } });
  assert.equal(hidden.status, 404);
  const denied = await adminPage({ request: new Request(HOST + '/staging-admin'), env: {
    DB: db, WORLDTV_STAGING_ADMIN_ENABLED: 'true', WORLDTV_STAGING_ADMIN_UI_ENABLED: 'true' } });
  assert.equal(denied.status, 403);
});
