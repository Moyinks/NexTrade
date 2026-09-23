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


// 11) Shared visual operating system must stay wired globally.
for (const asset of [
  'brand-system.css',
  'design-system.css',
  'transaction-ui.js'
]) {
  if (!fs.existsSync(path.join(root, asset))) {
    fail(`Missing design-system asset: ${asset}`);
  }
}

const indexSource = read('index.html');
const loginSource = read('login.html');
const walletSource = read('wallet.js');
const homeSource = read('home.js');
const feedSource = read('feed.js');
const transactionUiSource = read('transaction-ui.js');

for (const ref of [
  'brand-system.css',
  'design-system.css',
  'transaction-ui.js'
]) {
  if (!indexSource.includes(ref)) {
    fail(`index.html does not load ${ref}`);
  }
}

if (!loginSource.includes('brand-system.css')) {
  fail('Landing/auth does not consume shared brand foundation');
}

for (const [file, source] of [
  ['wallet.js', walletSource],
  ['home.js', homeSource],
  ['feed.js', feedSource]
]) {
  if (!source.includes('TransactionUI.present')) {
    fail(`${file} bypasses shared transaction presentation`);
  }
}

if (walletSource.includes('const TX_META')) {
  fail('wallet.js reintroduced local transaction semantics');
}

if (homeSource.includes('function typeMeta(tx)')) {
  fail('home.js reintroduced local transaction semantics');
}

if (walletSource.includes('#475569')) {
  fail('Wallet tabs reintroduced known low-contrast inactive text');
}

for (const requiredState of [
  'pending',
  'approved',
  'completed',
  'rejected',
  'failed',
  'cancelled'
]) {
  if (!transactionUiSource.includes(requiredState)) {
    fail(`TransactionUI missing state: ${requiredState}`);
  }
}

if (
  !failures.some((x) =>
    x.includes('design-system') ||
    x.includes('shared transaction') ||
    x.includes('local transaction') ||
    x.includes('low-contrast') ||
    x.includes('TransactionUI')
  )
) {
  pass('Shared institutional design/transaction system');
}


// 12) Demo settlement architecture: safe, centralized, and operational.
const demoRequired = [
  'demo-deposit.css','demo-deposit.js','admin-review.css','admin-review.js',
  'api/demo-deposit.js','api/admin-deposit-reviews.js','api/admin-push.js',
  'server/supabase-server.js','server/admin-push.js','MIGRATION_DEMO_SETTLEMENT.sql',
  'scripts/design-debt.mjs','DESIGN_DEBT_BASELINE.json'
];
for (const file of demoRequired) if (!fs.existsSync(path.join(root,file))) fail(`Missing demo settlement component: ${file}`);
const demoConfig = read('config.js');
const demoPage = read('demo-deposit.js');
const adminPage = read('admin-review.js');
const appController = read('app.js');
const canonicalSchema = read('SCHEMA.sql');
if (!/realDeposit:\s*false/.test(demoConfig)) fail('Demo settlement does not keep realDeposit false');
if (!/demoDeposit:\s*true/.test(demoConfig)) fail('Demo settlement feature is not enabled');
if (!/demoDeposit:\s*['"]\/api\/demo-deposit['"]/.test(demoConfig)) fail('Browser demo deposit route is not canonical');
if (/test-manual-deposit/.test(demoConfig)) fail('Legacy preview-only deposit route remains in browser config');
if (fs.existsSync(path.join(root,'api/test-manual-deposit.js'))) fail('Legacy preview-only manual-deposit API still exists');
for (const [file,source] of [['demo-deposit.js',demoPage],['admin-review.js',adminPage]]) {
  if (/\.style(?:\.cssText|\.[A-Za-z_$][\w$]*)\s*=/.test(source)) fail(`${file} contains imperative presentation styling`);
  if (/\bstyle\s*=\s*["'`]/.test(source)) fail(`${file} contains inline style markup`);
  if (/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(source)) fail(`${file} contains hard-coded presentation colors`);
}
for (const required of ['deposit_review_requests','create_demo_deposit_request','process_demo_deposit_review','admin_push_subscriptions','demo_deposits_enabled','supabase_realtime add table public.transactions']) {
  if (!canonicalSchema.includes(required)) fail(`SCHEMA.sql missing demo settlement contract: ${required}`);
}
if (!/payload\.eventType === 'UPDATE'/.test(appController)) fail('Realtime listener does not refresh transaction updates');
if (!/self\.addEventListener\('push'/.test(sw)) fail('Service worker does not handle admin push alerts');
const debt = spawnSync(process.execPath,['scripts/design-debt.mjs'],{cwd:root,encoding:'utf8'});
if (debt.status !== 0) fail(`Design-debt ratchet: ${(debt.stderr || debt.stdout || '').trim()}`); else pass('Design debt ratchet did not increase');
if (!failures.some((x) => x.includes('demo settlement') || x.includes('Demo settlement') || x.includes('presentation styling') || x.includes('hard-coded presentation') || x.includes('Realtime listener') || x.includes('push alerts'))) pass('Demo settlement architecture');


// 13) Theme, attention arbitration, and durable transaction-record architecture.
const architectureFiles = [
  'ARCHITECTURE_RULES.md', 'theme-bootstrap.js', 'preferences.js', 'theme.js',
  'experience.js', 'themes.css', 'legacy-theme-bridge.css', 'experience.css', 'settings.js', 'settings.css',
  'transaction-detail.js', 'transaction-detail.css'
];
for (const file of architectureFiles) {
  if (!fs.existsSync(path.join(root, file))) fail(`Missing architecture component: ${file}`);
}
const themeIndex = read('index.html');
const appController2 = read('app.js');
const walletModule2 = read('wallet.js');
const homeModule2 = read('home.js');
const depositModule2 = read('demo-deposit.js');
const pwaModule2 = read('index-pwa.js');
const themeBootstrap2 = read('theme-bootstrap.js');
const themeCss2 = read('themes.css');
const transactionDetail2 = read('transaction-detail.js');
const architectureRules2 = read('ARCHITECTURE_RULES.md');
for (const asset of ['theme-bootstrap.js','preferences.js','theme.js','experience.js','themes.css','legacy-theme-bridge.css','experience.css','settings.js','settings.css','transaction-detail.js','transaction-detail.css']) {
  if (!themeIndex.includes(asset)) fail(`index.html does not load ${asset}`);
}
if (!themeBootstrap2.includes("preference = 'dark'")) fail('First-entry theme is not explicitly Dark');
if (!themeCss2.includes('html[data-theme="light"]')) fail('Light theme token layer missing');
if (!themeCss2.includes('html[data-theme="dark"]')) fail('Dark theme token layer missing');
if (!pwaModule2.includes('reportInstallState')) fail('Install prompt does not participate in attention arbitration');
if (!appController2.includes('ExperienceOrchestrator.noteNavigation')) fail('Navigation does not inform experience arbitration');
if (!appController2.includes('ExperienceOrchestrator.markAppReady')) fail('App readiness does not inform experience arbitration');
if (!walletModule2.includes("Transactiondetail.open(tx.id, 'wallet')")) fail('Wallet transactions do not open durable records');
if (!homeModule2.includes("Transactiondetail.open(tx.id, 'home')")) fail('Home transactions do not open durable records');
if (/if\s*\(\s*pending\s*\)\s*\{\s*flow\.stage\s*=\s*['"]status['"]/.test(depositModule2)) fail('Pending deposit still hijacks the Deposit creation route');
if (!depositModule2.includes("Transactiondetail.open(tx.id, source)")) fail('Deposit pending context cannot open its durable transaction record');
for (const file of ['theme-bootstrap.js','preferences.js','theme.js','experience.js','settings.js','transaction-detail.js','demo-deposit.js']) {
  const source = read(file);
  if (/\.style(?:\.cssText|\.[A-Za-z_$][\w$]*)\s*=/.test(source)) fail(`${file} contains imperative presentation styling`);
  if (/\bstyle\s*=\s*["'`]/.test(source)) fail(`${file} contains inline style markup`);
}
for (const principle of ['Design the seam for the future without paying the complexity cost today.','Different surfaces may have different personalities. They must not have different laws.']) {
  if (!architectureRules2.includes(principle)) fail(`Architecture constitution missing principle: ${principle}`);
}
if (!transactionDetail2.includes('window.print()')) fail('Transaction receipt has no print/PDF path');
if (!transactionDetail2.includes('navigator.share')) fail('Transaction receipt has no native-share path');
if (!failures.some((x) => x.includes('architecture component') || x.includes('First-entry theme') || x.includes('Light theme') || x.includes('Dark theme') || x.includes('attention arbitration') || x.includes('durable records') || x.includes('Deposit creation route') || x.includes('presentation styling') || x.includes('Architecture constitution') || x.includes('receipt'))) {
  pass('Theme/transaction architecture');
}


// Interaction quality system.
{
  const interactionCss = read('interaction-system.css');
  const appSource = read('app.js');
  const walletSource = read('wallet.js');
  const depositSource = read('demo-deposit.js');
  const virtualScrollerSource = read('virtual-scroller.js');
  const architectureSource = read('ARCHITECTURE_RULES.md');

  if (!interactionCss.includes('--nt-motion-press-in')) {
    fail('Interaction motion tokens missing');
  }

  if (!appSource.includes('async function back(')) {
    fail('Origin-aware App.back authority missing');
  }

  if (!appSource.includes('captureRouteSnapshot')) {
    fail('Navigation does not capture route origin/state');
  }

  if (/currentPage === 'wallet'[\s\S]{0,220}Wallet\.render/.test(appSource)) {
    fail('Background polling still reconstructs Wallet');
  }

  if (!walletSource.includes('scheduleActiveRefresh')) {
    fail('Wallet has no motion-safe refresh scheduler');
  }

  if (!walletSource.includes('getNavigationState')) {
    fail('Wallet cannot preserve tab/scroll navigation state');
  }

  if (!virtualScrollerSource.includes('lastStartIndex')) {
    fail('VirtualScroller still rebuilds the same render window every scroll frame');
  }

  if (!depositSource.includes('demo-method-trigger')) {
    fail('Deposit payment method is not progressively disclosed');
  }

  if (!depositSource.includes('demo-sheet-layer')) {
    fail('Deposit payment method sheet missing');
  }

  for (const principle of [
    'Persistent screen space must be earned by persistent relevance.',
    'Never interrupt user-owned motion with application-owned rendering.',
    'Back means origin, not destination.'
  ]) {
    if (!architectureSource.includes(principle)) {
      fail(`Architecture constitution missing: ${principle}`);
    }
  }

  if (!failures.some((x) =>
    x.includes('Interaction motion') ||
    x.includes('Origin-aware') ||
    x.includes('Navigation does not capture') ||
    x.includes('reconstructs Wallet') ||
    x.includes('motion-safe refresh') ||
    x.includes('preserve tab/scroll') ||
    x.includes('same render window') ||
    x.includes('progressively disclosed') ||
    x.includes('method sheet') ||
    x.includes('Architecture constitution missing')
  )) {
    pass('Touch/navigation quality system');
  }
}


// Surface + spatial architecture.
{
  const appSource = read('app.js');
  const homeSource = read('home.js');
  const walletSource = read('wallet.js');
  const marketSource = read('market.js');
  const settingsSource = read('settings.js');
  const surfaceCss = read('surface-spatial.css');
  const architectureSource = read('ARCHITECTURE_RULES.md');
  if (!appSource.includes('navigationState.primary')) fail('Primary routes do not own independent scroll state');
  if (!homeSource.includes('getNavigationState')) fail('Home cannot preserve its inner scroll state');
  if (!walletSource.includes('createHeroActivityShortcut')) fail('Wallet hero has no compact Activity affordance');
  if (/createOverviewTab[\s\S]{0,900}createRecentActivity\(\)/.test(walletSource)) fail('Wallet Overview still duplicates Recent Activity');
  if (!surfaceCss.includes('body[data-route="wallet"] .overview-tab')) fail('Wallet Overview viewport composition missing');
  if (marketSource.includes("background:  { color: 'transparent' }")) fail('Market chart still inherits a transparent background');
  if (!settingsSource.includes('settings-sheet-layer')) fail('Settings Theme control is not progressively disclosed');
  for (const principle of ['A route owns its position in space.','Semantic colour belongs to information, not decoration.','Transparency is physical, not hierarchical.','Immersion comes from continuity and hierarchy, not more layers.']) {
    if (!architectureSource.includes(principle)) fail(`Architecture constitution missing: ${principle}`);
  }
  const surfaceDebt = spawnSync(process.execPath,[path.join(root,'scripts/surface-debt.mjs')],{encoding:'utf8'});
  if (surfaceDebt.status !== 0) fail('Surface/transparency debt ratchet failed: '+(surfaceDebt.stderr||surfaceDebt.stdout||'').trim());
  else pass('Surface/transparency debt ratchet did not increase');
  if (!failures.some((x)=>x.includes('independent scroll state')||x.includes('inner scroll state')||x.includes('Activity affordance')||x.includes('duplicates Recent Activity')||x.includes('viewport composition')||x.includes('transparent background')||x.includes('progressively disclosed')||x.includes('Architecture constitution missing')||x.includes('Surface/transparency debt ratchet'))) pass('Surface/spatial architecture');
}

console.log('\nNexTrade release audit');
console.log('======================');
for (const p of passes) console.log(`PASS  ${p}`);
for (const f of failures) console.error(`FAIL  ${f}`);
console.log(`\n${passes.length} checks passed; ${failures.length} failures.`);
if (failures.length) process.exit(1);
