#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd');
const targetDir = path.join(root, 'vendor', 'supabase');

if (!fs.existsSync(sourceDir)) {
  console.error('Missing @supabase/supabase-js browser bundle. Run npm install first.');
  process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });

const entry = path.join(targetDir, 'supabase.js');
if (!fs.existsSync(entry) || fs.statSync(entry).size < 10000) {
  console.error('Supabase UMD entry was not generated as expected.');
  process.exit(1);
}

console.log(`Bundled Supabase browser runtime: ${path.relative(root, entry)}`);
