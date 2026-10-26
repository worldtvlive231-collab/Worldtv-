import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file) => readFileSync(resolve('cloudflare/public-site', file), 'utf8');
const page = read('index.html');
const download = read('download.html');
const help = read('help.html');
const status = read('status.html');
const redirects = read('_redirects');
const headers = read('_headers');

test('public information pages are wired into the deployed homepage', () => {
  for (const link of ['/download.html', '/help.html']) {
    assert.ok(page.includes('href="' + link + '"'), 'Homepage must link ' + link);
  }
  assert.match(download, /WORLD TV Android/);
  assert.match(help, /WORLD TV support centre/);
  assert.match(help, /worldtvlive231@gmail\.com/);
  assert.match(download, /worldtvlive231@gmail\.com/);
});
test('download page is informational, does not bypass Android security or distribute unverified APK', () => {
  assert.doesNotMatch(download, /href=["'][^"']+\.apk/i);
  assert.doesNotMatch(download, /<form\b/i);
  assert.doesNotMatch(download, /\binstall anyway\b/i);
  assert.match(download, /download button is <strong>not yet available<\/strong>/);
  assert.match(download, /Do not disable Play Protect/);
});
test('offline customer, admin and payment routes remain protected', () => {
  for (const route of ['/admin.html', '/subscribe.html', '/login.html', '/register.html', '/account.html']) {
    assert.ok(redirects.includes(route + ' /status.html 302'), 'Missing protected route: ' + route);
  }
  assert.doesNotMatch(redirects, /^\/download\.html /m);
  assert.match(status, /does not process payments, accept credentials or change customer data/i);
});
test('no payment forms, live payment links or exposed admin credentials on public pages', () => {
  for (const text of [page, download, help, status]) {
    assert.doesNotMatch(text, /<form\b|paystack\.shop|pocketi\.shop|\/api\/(?:payment|admin|auth)/i);
    assert.doesNotMatch(text, /WORLDTV_STAGING_ADMIN_EMAILS|WORLDTV_ACCESS_AUD|WORLDTV_TURNSTILE_SECRET/);
  }
});
test('public site includes basic security response headers', () => {
  assert.match(headers, /X-Content-Type-Options:\s*nosniff/i);
  assert.match(headers, /Content-Security-Policy:/i);
  assert.match(headers, /form-action 'none'/i);
});
