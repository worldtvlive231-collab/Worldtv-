import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const page = await readFile(new URL('../subscribe.html', import.meta.url), 'utf8');
const previewBuilder = await readFile(new URL('../cloudflare/build-preview.mjs', import.meta.url), 'utf8');
const pocketi = 'https://pocketi.shop/worldtv/p/worldtv-yearly-subscription';

test('both Ghana CTAs point to the exact hosted Pocketi payment page in a new tab', () => {
  const tags = [...page.matchAll(/<a\b[^>]*data-payment-region="ghana"[^>]*>/g)].map(match => match[0]);
  assert.equal(tags.length, 2);
  for (const tag of tags) {
    assert.ok(tag.includes('href="' + pocketi + '"'));
    assert.match(tag, /target="_blank"/);
    assert.match(tag, /rel="noopener noreferrer"/);
  }
});

test('Ghana checkout is not intercepted by the old in-page Mobile Money modal', () => {
  assert.match(page, /if \(link\.dataset\.paymentRegion === 'ghana'\) return;\s*event\.preventDefault\(\);/);
  assert.doesNotMatch(page, /if \(requested === 'ghana'\) openPocketi\(\);/);
});

test('sticky mobile checkout follows the selected Ghana/Worldwide tab', () => {
  assert.match(page, /const pocketiUrl = 'https:\/\/pocketi\.shop\/worldtv\/p\/worldtv-yearly-subscription';/);
  assert.match(page, /mobileCta\.dataset\.paymentRegion = region;[\s\S]*?mobileCta\.href = region === 'ghana' \? pocketiUrl : worldwideUrl;/);
  assert.match(page, /if \(requested === 'ghana'\) selectRegion\('ghana'\);/);
});

test('hosted checkout instructions do not promise code delivery without verification', () => {
  assert.match(page, /Staff must independently verify the merchant transaction before issuing your one-year code/);
  assert.doesNotMatch(page, /After successful payment, your code is issued automatically/);
});

test('manual Pocketi confirmation gives a real support-email workflow without false activation promises', () => {
  const mailto = 'mailto:support@myworldtvlive.com?subject=WORLD%20TV%20Pocketi%20payment%20verification';
  assert.equal(page.split(mailto).length - 1, 3);
  assert.match(page, /WORLD TV will verify the payment in its Pocketi merchant records/);
  assert.match(page, /Never send card numbers, payment PINs, passwords or one-time codes/);
  assert.match(page, /A receipt or screenshot alone does not prove a payment was successful/);
});

test('old Ghana in-page payment modal, API initialization, and polling were retired', () => {
  assert.doesNotMatch(page, /id="pocketi-modal"|id="pocketi-form"/);
  assert.doesNotMatch(page, /openPocketi\(|pollPocketi\(/);
  assert.doesNotMatch(page, /\/api\/payment\/pocketi\/(?:initialize|status)/);
  assert.doesNotMatch(page, /wtv_pending_pocketi_order/);
});

test('worldwide Paystack checkout remains available unchanged', () => {
  assert.match(page, /https:\/\/paystack\.shop\/pay\/x4sqejilmz/);
  assert.match(page, /const payment = await jsonRequest\('\/api\/payment\/paystack\/hosted-intent'/);
});

test('Cloudflare staging build does not expose any live hosted checkout', () => {
  assert.match(previewBuilder, /href="\\\/subscribe\\\.html/);
  assert.match(previewBuilder, /'href="\/staging-lab"'/);
  assert.doesNotMatch(previewBuilder, /copyIfExists\(join\(projectRoot, 'subscribe\.html'/);
});
