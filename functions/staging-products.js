import { reply } from './_lib/staging-auth.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  if (url.hostname !== 'worldtv-preview.pages.dev' ||
      context.env?.WORLDTV_STAGING_UI_ENABLED !== 'true') {
    return reply({ error: 'Not found' }, 404);
  }
  const nonce = crypto.randomUUID().replaceAll('-', '');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>WORLD TV staging products</title><style nonce="${nonce}">
body{margin:0;background:#0c0d11;color:#f7f7f8;font:16px system-ui;line-height:1.5}main{max-width:720px;margin:3rem auto;padding:1.2rem}.card{background:#17191f;border:1px solid #343844;border-radius:18px;padding:1.4rem}h1{color:#f4c64d}a{color:#f4c64d}.status{padding:1rem;border-radius:10px;background:#332a13;color:#ffe7a2}</style></head><body><main><div class="card">
<h1>WORLD TV products</h1><p class="status"><strong>Staging check:</strong> product orders are not accepting payment yet.</p>
<p>The product catalog and order flow will open after inventory, delivery pricing and Paystack sandbox reconciliation pass.</p>
<p><a href="/">Back to staging home</a> · <a href="/staging-lab">Subscription test lab</a></p>
</div></main></body></html>`, { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`
  }});
}
