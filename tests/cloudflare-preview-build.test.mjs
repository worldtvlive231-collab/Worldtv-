import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const exec = promisify(execFile);

test('preview build keeps navigation on Cloudflare staging routes', async () => {
  await exec(process.execPath, ['cloudflare/build-preview.mjs']);
  const home = await readFile('cloudflare/preview-dist/index.html', 'utf8');
  assert.match(home, /WORLD TV STAGING/);
  assert.match(home, /href="\/staging-account"/);
  assert.match(home, /href="\/staging-lab"/);
  assert.match(home, /href="\/staging-download"/);
  assert.match(home, /href="\/staging-products"/);
  assert.doesNotMatch(home, /location\.href="https:\/\/myworldtvlive\.com"/);
  for (const page of ['about.html', 'terms.html', 'privacy.html', 'refund.html']) {
    assert.match(await readFile('cloudflare/preview-dist/' + page, 'utf8'), /WORLD TV STAGING/);
  }
});
