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

test('worldwide Paystack checkout remains available unchanged', () => {
  assert.match(page, /https:\/\/paystack\.shop\/pay\/x4sqejilmz/);
  assert.match(page, /const payment = await jsonRequest\('\/api\/payment\/paystack\/hosted-intent'/);
});

test('Cloudflare staging build does not expose any live hosted checkout', () => {
  assert.match(previewBuilder, /href="\\\/subscribe\\\.html/);
  assert.match(previewBuilder, /'href="\/staging-lab"'/);
  assert.doesNotMatch(previewBuilder, /copyIfExists\(join\(projectRoot, 'subscribe\.html'/);
});
