#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const baselinePath=path.join(root,'DESIGN_DEBT_BASELINE.json');
function walk(dir=''){const abs=path.join(root,dir);return fs.readdirSync(abs,{withFileTypes:true}).flatMap(entry=>{const rel=path.join(dir,entry.name);if(entry.name==='node_modules'||entry.name==='.git'||entry.name==='vendor'||rel.startsWith('api/')||rel.startsWith('server/')||rel.startsWith('scripts/'))return[];return entry.isDirectory()?walk(rel):[rel.replaceAll('\\','/')]})}
const files=walk().filter(file=>file.endsWith('.js'));
function measure(source){return{styleAssignments:(source.match(/\.style(?:\.cssText|\.[A-Za-z_$][\w$]*)\s*=/g)||[]).length,inlineStyleMarkup:(source.match(/\bstyle\s*=\s*["'`]/g)||[]).length,hardcodedColors:(source.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g)||[]).length}}
const current=Object.fromEntries(files.map(file=>[file,measure(fs.readFileSync(path.join(root,file),'utf8'))]));
if(process.argv.includes('--write-baseline')){fs.writeFileSync(baselinePath,JSON.stringify({generatedBy:'scripts/design-debt.mjs',files:current},null,2)+'\n');console.log(`Wrote design-debt baseline for ${files.length} browser modules.`);process.exit(0)}
if(!fs.existsSync(baselinePath)){console.error('Missing DESIGN_DEBT_BASELINE.json');process.exit(1)}
const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8')).files||{};const failures=[];
for(const[file,metrics]of Object.entries(current)){const budget=baseline[file]||{styleAssignments:0,inlineStyleMarkup:0,hardcodedColors:0};for(const key of['styleAssignments','inlineStyleMarkup','hardcodedColors'])if(metrics[key]>Number(budget[key]||0))failures.push(`${file}: ${key} increased ${budget[key]||0} → ${metrics[key]}`)}
if(failures.length){console.error('\nDesign-debt ratchet failed');failures.forEach(f=>console.error(`FAIL  ${f}`));process.exit(1)}
console.log(`PASS  Design debt did not increase across ${files.length} browser modules`);
