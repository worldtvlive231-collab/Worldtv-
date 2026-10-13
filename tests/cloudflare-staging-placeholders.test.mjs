import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as downloadPage } from '../functions/staging-download.js';
import { onRequestGet as productsPage } from '../functions/staging-products.js';

const previewHost = 'https://worldtv-preview.pages.dev';

for (const [name, path, handler] of [
  ['download', '/staging-download', downloadPage],
  ['products', '/staging-products', productsPage],
]) {
  test(`${name} placeholder is hidden unless the staging UI is enabled`, async () => {
    const disabled = await handler({ request: new Request(previewHost + path), env: {} });
    assert.equal(disabled.status, 404);

    const liveDomain = await handler({
      request: new Request('https://myworldtvlive.com' + path),
      env: { WORLDTV_STAGING_UI_ENABLED: 'true' },
    });
    assert.equal(liveDomain.status, 404);
  });

  test(`${name} placeholder is no-store and exposes no live action`, async () => {
    const response = await handler({
      request: new Request(previewHost + path),
      env: { WORLDTV_STAGING_UI_ENABLED: 'true' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);

    const html = await response.text();
    assert.match(html, /Staging check:/);
    assert.doesNotMatch(html, /paystack\.co|paystack\.com|paystack\.shop/);
    assert.doesNotMatch(html, /href="[^"]+\.apk/);
  });
}
