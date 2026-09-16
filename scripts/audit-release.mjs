#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const failures = [];
const passes = [];

function fail(msg) { failures.push(msg); }
function pass(msg) { passes.push(msg); }
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }
function filesRecursive(dir='') {
  const abs = path.join(root, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') return [];
    return entry.isDirectory() ? filesRecursive(rel) : [rel.replaceAll('\\','/')];
  });
}

const allFiles = filesRecursive();
const bundledRuntimes = [
  ['vendor/supabase/supabase.js', 'Bundled Supabase browser runtime present'],
  ['vendor/fontawesome/css/all.min.css', 'Bundled Font Awesome CSS present'],
  ['vendor/fontawesome/webfonts/fa-solid-900.woff2', 'Bundled Font Awesome solid font present'],
  ['vendor/fontawesome/webfonts/fa-regular-400.woff2', 'Bundled Font Awesome regular font present'],
  ['vendor/lightweight-charts/lightweight-charts.standalone.production.js', 'Bundled Lightweight Charts runtime present'],
];
for (const [runtime, label] of bundledRuntimes) {
  if (!fs.existsSync(path.join(root, runtime))) fail(`Missing bundled browser runtime: ${runtime}`);
  else pass(label);
}

const jsFiles = allFiles.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
const htmlFiles = allFiles.filter((f) => f.endsWith('.html'));

// 1) JavaScript syntax.
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status !== 0) fail(`JavaScript syntax: ${file}: ${result.stderr.trim()}`);
}
if (!failures.some((x) => x.startsWith('JavaScript syntax:'))) pass(`JavaScript syntax (${jsFiles.length} files)`);

// 2) Required JSON files parse.
for (const file of ['package.json','manifest.json','vercel.json']) {
  try { JSON.parse(read(file)); pass(`JSON parses: ${file}`); }
  catch (err) { fail(`JSON parse failed: ${file}: ${err.message}`); }
}

// 3) HTML local asset references exist + duplicate IDs.
for (const file of htmlFiles) {
  const html = read(file);
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) fail(`Duplicate DOM IDs in ${file}: ${dupes.join(', ')}`);
  else pass(`No duplicate DOM IDs: ${file}`);

  const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']([^"'#?]+)(?:[?#][^"']*)?["']/gi)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(?:https?:|data:|blob:|mailto:|tel:|\/\/)/i.test(ref)) continue;
    const clean = ref.startsWith('/') ? ref.slice(1) : ref;
    if (!clean || clean === '.') continue;
    if (!fs.existsSync(path.join(root, clean))) fail(`Missing local asset referenced by ${file}: ${ref}`);
  }
}
if (!failures.some((x) => x.startsWith('Missing local asset'))) pass('All local HTML asset references resolve');

// 4) Service-worker precache entries exist.
const sw = read('sw.js');
const precacheBlock = sw.match(/const\s+PRECACHE_URLS\s*=\s*\[([\s\S]*?)\];/);
if (!precacheBlock) fail('Could not parse PRECACHE_URLS from sw.js');
else {
  const urls = [...precacheBlock[1].matchAll(/["'](\/[^"']+)["']/g)].map((m) => m[1]);
  for (const url of urls) {
    const clean = url.slice(1);
    if (!fs.existsSync(path.join(root, clean))) fail(`Missing service-worker precache asset: ${url}`);
  }
  if (!failures.some((x) => x.startsWith('Missing service-worker'))) pass(`Service-worker precache resolves (${urls.length} assets)`);
}

// 5) Browser/server RPC names must exist in canonical schema.
const runtimeSources = allFiles.filter((f) => (f.endsWith('.js') || f.endsWith('.html')) && !f.startsWith('scripts/'));
const rpcCalls = new Set();
for (const file of runtimeSources) {
  const src = read(file);
  for (const m of src.matchAll(/\.rpc\(\s*["']([A-Za-z0-9_]+)["']/g)) rpcCalls.add(m[1]);
}
const schema = read('SCHEMA.sql');
const schemaFns = new Set([...schema.matchAll(/create\s+or\s+replace\s+function\s+public\.([A-Za-z0-9_]+)\s*\(/gi)].map((m) => m[1]));
const missingRpcs = [...rpcCalls].filter((name) => !schemaFns.has(name));
if (missingRpcs.length) fail(`Runtime RPCs missing from SCHEMA.sql: ${missingRpcs.join(', ')}`);
else pass(`RPC/schema contract (${rpcCalls.size} runtime RPCs)`);

// 6) Coin artwork must use the same-origin allowlisted proxy.
const apiSource = read('api.js');
const coinImageApi = read('api/coin-image.js');
const rawCoinImageAssignments = [
  /image:\s*coin\.image/,
  /image:\s*data\.image(?:\?|\.)/,
  /thumb:\s*coin\.thumb/,
  /thumb:\s*item\.item\.thumb/,
];
if (!/\/api\/coin-image\?url=/.test(apiSource)) fail('Browser market data does not normalize coin artwork through /api/coin-image');
else if (rawCoinImageAssignments.some((pattern) => pattern.test(apiSource))) fail('Raw CoinGecko artwork URL still enters browser state');
else if (!/assets\.coingecko\.com/.test(coinImageApi) || !/coin-images\.coingecko\.com/.test(coinImageApi)) fail('Coin image proxy allowlist is incomplete');
else if (!/redirect:\s*['"]manual['"]/.test(coinImageApi)) fail('Coin image proxy does not validate redirects');
else if (/image\/svg\+xml/.test(coinImageApi)) fail('Coin image proxy permits active SVG content');
else if (!/MAX_IMAGE_BYTES/.test(coinImageApi) || !/readBodyWithLimit/.test(coinImageApi)) fail('Coin image proxy lacks bounded response handling');
else pass('Coin artwork uses bounded same-origin allowlisted proxy');

// 7) Public release must not leak private sibling branding.
for (const file of allFiles.filter((f) => /\.(?:js|mjs|html|css|sql|json|md|example)$/i.test(f))) {
  if (/\bYelda\b/i.test(read(file))) fail(`Private sibling brand leaked in ${file}`);
}
if (!failures.some((x) => x.startsWith('Private sibling'))) pass('No private sibling branding');

// 8) Heuristic: browser code must not directly mutate protected financial tables.
const protectedTables = ['transactions','investments','profiles','kyc_documents'];
for (const file of allFiles.filter((f) => f.endsWith('.js') && !f.startsWith('api/') && !f.startsWith('scripts/'))) {
  const src = read(file);
  for (const table of protectedTables) {
    const pattern = new RegExp(`\\.from\\(\\s*['\"]${table}['\"]\\s*\\)[\\s\\S]{0,240}?\\.(?:insert|update|delete|upsert)\\s*\\(`, 'gi');
    if (pattern.test(src)) fail(`Direct browser mutation of protected table ${table} in ${file}`);
  }
}
if (!failures.some((x) => x.startsWith('Direct browser mutation'))) pass('No obvious browser writes to protected financial/KYC tables');

// 9) Public configuration must remain portfolio/fail-closed.
const config = read('config.js');
if (!/environment:\s*['"]portfolio['"]/.test(config)) fail('config.js is not explicitly portfolio environment');
if (!/realDeposit:\s*false/.test(config)) fail('Public config does not fail closed for real deposits');
if (!/hdWallet:\s*false/.test(config)) fail('Public config does not fail closed for HD wallet generation');
if (!failures.some((x) => x.includes('Public config') || x.includes('portfolio environment'))) pass('Public financial features fail closed by default');

// 10) No obvious privileged secret material in committed text.
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bxprv[A-Za-z0-9]+/,
  /SUPABASE_SERVICE_KEY\s*[:=]\s*["'][^"']+["']/,
];
for (const file of allFiles.filter((f) => /\.(?:js|mjs|html|css|sql|json|md|example)$/i.test(f))) {
  const src = read(file);
  for (const pattern of secretPatterns) if (pattern.test(src)) fail(`Possible privileged secret committed in ${file}`);
}
if (!failures.some((x) => x.startsWith('Possible privileged secret'))) pass('No obvious committed privileged secret material');

console.log('\nNexTrade release audit');
console.log('======================');
for (const p of passes) console.log(`PASS  ${p}`);
for (const f of failures) console.error(`FAIL  ${f}`);
console.log(`\n${passes.length} checks passed; ${failures.length} failures.`);
if (failures.length) process.exit(1);
