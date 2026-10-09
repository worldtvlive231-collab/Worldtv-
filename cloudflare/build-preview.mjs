/**
 * Build a SAFE, READ-ONLY Cloudflare Pages preview of the public landing page.
 * This is not the production migration: APIs, customer logins, subscriptions,
 * downloads, payments, live chat and database still run on the current host.
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
  'CLOUDFLARE PREVIEW ONLY — This copy does not process accounts, payments or subscriptions. ',
  '<a href="https://myworldtvlive.com/" style="color:#063c92;text-decoration:underline">Open the live WORLD TV website</a>',
  '</div>',
].join('');

const safePreviewScript = [
  '<script>',
  '(function(){',
  'document.addEventListener("submit",function(event){event.preventDefault();alert("Preview only. Use myworldtvlive.com for customer actions.");},true);',
  'document.addEventListener("click",function(event){',
  'var link=event.target.closest&&event.target.closest("a[href]");if(!link)return;',
  'try{var url=new URL(link.href);if(url.origin===location.origin){',
  'event.preventDefault();location.href="https://myworldtvlive.com"+url.pathname+url.search+url.hash;',
  '}}catch(e){}',
  '},true);',
  '})();',
  '</script>',
].join('');

home = home.replace(/<head>/i, '<head>\n<meta name="robots" content="noindex,nofollow">');
home = home.replace(/<body([^>]*)>/i, '<body$1>' + banner + safePreviewScript);
await writeFile(join(outputRoot, 'index.html'), home);
await writeFile(join(outputRoot, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n');

await copyAssets(join(projectRoot, 'assets'), join(outputRoot, 'assets'));
for (const file of ['world-tv-logo.png', 'favicon.ico', 'manifest.webmanifest', 'robots.txt']) {
  await copyIfExists(join(projectRoot, file), join(outputRoot, file));
}

console.log('Read-only Pages preview built at ' + outputRoot);
console.log('Do NOT attach myworldtvlive.com to this preview. Production API and database are not migrated.');
