#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requirePath(abs, label) {
  if (!fs.existsSync(abs)) {
    console.error(`Missing ${label}. Run npm install first.`);
    process.exit(1);
  }
}

function resetDir(abs) {
  fs.rmSync(abs, { recursive: true, force: true });
  fs.mkdirSync(abs, { recursive: true });
}

// Supabase browser runtime.
{
  const sourceDir = path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd');
  const targetDir = path.join(root, 'vendor', 'supabase');
  requirePath(sourceDir, '@supabase/supabase-js browser bundle');
  resetDir(targetDir);
  fs.cpSync(sourceDir, targetDir, { recursive: true });
  const entry = path.join(targetDir, 'supabase.js');
  if (!fs.existsSync(entry) || fs.statSync(entry).size < 10000) {
    console.error('Supabase UMD entry was not generated as expected.');
    process.exit(1);
  }
  console.log(`Bundled Supabase browser runtime: ${path.relative(root, entry)}`);
}

// Font Awesome UI runtime. The application uses fa-solid/fas and some regular
// icons throughout navigation, wallet, modals, market and auth surfaces.
{
  const pkg = path.join(root, 'node_modules', '@fortawesome', 'fontawesome-free');
  const cssSource = path.join(pkg, 'css', 'all.min.css');
  const fontsSource = path.join(pkg, 'webfonts');
  const targetDir = path.join(root, 'vendor', 'fontawesome');
  requirePath(cssSource, 'Font Awesome CSS');
  requirePath(fontsSource, 'Font Awesome webfonts');
  resetDir(targetDir);
  fs.mkdirSync(path.join(targetDir, 'css'), { recursive: true });
  fs.copyFileSync(cssSource, path.join(targetDir, 'css', 'all.min.css'));
  fs.cpSync(fontsSource, path.join(targetDir, 'webfonts'), { recursive: true });

  const solid = path.join(targetDir, 'webfonts', 'fa-solid-900.woff2');
  const regular = path.join(targetDir, 'webfonts', 'fa-regular-400.woff2');
  if (!fs.existsSync(solid) || !fs.existsSync(regular)) {
    console.error('Font Awesome webfonts were not generated as expected.');
    process.exit(1);
  }
  console.log('Bundled Font Awesome UI runtime');
}

// TradingView Lightweight Charts. It is a critical market-detail dependency,
// so serve it from the same Vercel origin instead of relying on unpkg at runtime.
{
  const source = path.join(root, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js');
  const targetDir = path.join(root, 'vendor', 'lightweight-charts');
  requirePath(source, 'Lightweight Charts standalone browser bundle');
  resetDir(targetDir);
  const target = path.join(targetDir, 'lightweight-charts.standalone.production.js');
  fs.copyFileSync(source, target);
  if (fs.statSync(target).size < 50000) {
    console.error('Lightweight Charts runtime was not generated as expected.');
    process.exit(1);
  }
  console.log(`Bundled Lightweight Charts runtime: ${path.relative(root, target)}`);
}
