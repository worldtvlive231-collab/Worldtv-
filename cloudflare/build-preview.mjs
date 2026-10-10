/**
 * Build the safe Cloudflare staging shell. Customer actions are linked only to
 * gated Pages Functions on the preview host. Payment remains test-only.
 *
 * Run: node cloudflare/build-preview.mjs
 * Cloudflare Pages build command: node cloudflare/build-preview.mjs
 * Cloudflare Pages output directory: cloudflare/preview-dist
 */
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(projectRoot, 'cloudflare', 'preview-dist');
const assetExtensions = new Set([
  '.css', '.js', '.mjs', '.json', '.png', '.jpg', '.jpeg', '.webp',
  '.svg', '.gif', '.avif', '.ico', '.woff', '.woff2', '.webmanifest',
]);
const maxAssetBytes = 25 * 1024 * 1024;

async function copyIfExists(source, destination) {
  try {
    const fileStat = await stat(source);
    if (!fileStat.isFile()) return;
    if (fileStat.size > maxAssetBytes) {
      throw new Error('File too large for Pages asset: ' + source);
    }
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function copyAssets(sourceDirectory, destinationDirectory) {
  let entries;
  try {
    entries = await readdir(sourceDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const source = join(sourceDirectory, entry.name);
    const destination = join(destinationDirectory, entry.name);
    if (entry.isDirectory()) {
      await copyAssets(source, destination);
    } else if (entry.isFile() && assetExtensions.has(extname(entry.name).toLowerCase())) {
      await copyIfExists(source, destination);
    }
  }
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

let home = await readFile(join(projectRoot, 'index.html'), 'utf8');
if (!/<body(?:\s|>)/i.test(home)) throw new Error('Cannot find body of index.html');

const banner = [
  '<div role="status" style="position:sticky;top:0;z-index:999999;background:#fff2b2;color:#1c1808;',
  'padding:12px 20px;font:700 14px system-ui,sans-serif;text-align:center;border-bottom:2px solid #bb8a04">',
  'WORLD TV STAGING — Test accounts only. Real payments are disabled. ',
  '<a href="/staging-account" style="color:#063c92;text-decoration:underline">Open staging account</a>',
  '</div>',
].join('');

function stagingLinks(html) {
  return html
    .replace(/href="\/(?:login|register|account|forgot-password|reset-password)\.html(?:\?[^"#]*)?(?:#[^"]*)?"/gi,
      'href="/staging-account"')
    .replace(/href="\/subscribe\.html(?:\?[^"#]*)?(?:#[^"]*)?"/gi,
      'href="/staging-lab"')
    .replace(/href="\/download\.html(?:\?[^"#]*)?(?:#[^"]*)?"/gi,
      'href="/staging-download"')
    .replace(/href="\/products\.html(?:\?[^"#]*)?(?:#[^"]*)?"/gi,
      'href="/staging-products"');
}

home = stagingLinks(home);
home = home.replace(/<head>/i, '<head>\n<meta name="robots" content="noindex,nofollow">');
home = home.replace(/<body([^>]*)>/i, '<body$1>' + banner);
await writeFile(join(outputRoot, 'index.html'), home);
await writeFile(join(outputRoot, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n');

for (const file of ['about.html', 'terms.html', 'privacy.html', 'refund.html']) {
  try {
    let page = await readFile(join(projectRoot, file), 'utf8');
    page = stagingLinks(page)
      .replace(/<head>/i, '<head>\n<meta name="robots" content="noindex,nofollow">')
      .replace(/<body([^>]*)>/i, '<body$1>' + banner);
    await writeFile(join(outputRoot, file), page);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

await copyAssets(join(projectRoot, 'assets'), join(outputRoot, 'assets'));
for (const file of ['world-tv-logo.png', 'favicon.ico', 'manifest.webmanifest', 'robots.txt']) {
  await copyIfExists(join(projectRoot, file), join(outputRoot, file));
}

console.log('Cloudflare staging shell built at ' + outputRoot);
console.log('Production DNS and live payments remain separate until acceptance tests pass.');
