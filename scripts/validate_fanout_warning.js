#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(ROOT, '.build');
const FANOUT_MANIFEST = path.join(BUILD_DIR, 'fanout_manifest.json');
const FANOUT_MISSING = path.join(BUILD_DIR, 'fanout_missing.json');
const FANOUT_DUPLICATES = path.join(BUILD_DIR, 'fanout_duplicates.json');
const REPORT = path.join(BUILD_DIR, 'fanout_warning_report.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }
function exists(p){ try { fs.accessSync(p); return true; } catch { return false; } }
function walk(dir){
  const out = [];
  if (!exists(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

function requiredFanout(rel){
  return rel === '/index.html'
    || rel === '/tools/index.html'
    || rel === '/glossary/index.html'
    || rel === '/medium/index.html'
    || rel === '/insights/index.html'
    || rel.startsWith('/personal-injury/')
    || rel.startsWith('/dentistry/')
    || rel.startsWith('/trt/')
    || rel.startsWith('/neuro/')
    || rel.startsWith('/uscis-medical/')
    || rel.startsWith('/insights/')
;
}

const warnings = [];
if (!exists(FANOUT_MANIFEST)) warnings.push('Missing .build/fanout_manifest.json');
if (!exists(FANOUT_MISSING)) warnings.push('Missing .build/fanout_missing.json');
if (!exists(FANOUT_DUPLICATES)) warnings.push('Missing .build/fanout_duplicates.json');

const htmlFiles = walk(ROOT).filter((fp)=> fp.endsWith('.html') && !fp.includes('/templates/') && !fp.includes('/node_modules/') && !fp.includes('/.git/'));
htmlFiles.forEach((fp)=> {
  const rel = fp.replace(ROOT, '').replace(/\\/g, '/');
  const html = fs.readFileSync(fp, 'utf8');
  if (!requiredFanout(rel)) return;
  if (!html.includes('data-fanout-block="true"')) warnings.push(`${rel}: missing visible fan-out block`);
  if (!html.includes('Related search intents')) warnings.push(`${rel}: missing semantic related search intents heading`);
  if (!html.includes('<nav class="fanout-grid"')) warnings.push(`${rel}: missing semantic fan-out nav block`);
  if (html.includes('class="fanout-query-cluster"')) warnings.push(`${rel}: hidden fan-out JSON payload still present`);
});

if (exists(FANOUT_MISSING)) {
  const missing = readJson(FANOUT_MISSING);
  missing.forEach((item)=> warnings.push(`${item.slug}: ${item.reason}`));
}
fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify({ warning_count: warnings.length, warnings }, null, 2) + '\n', 'utf8');
if (warnings.length) {
  console.warn(`FANOUT WARNING: ${warnings.length} warnings found.`);
  warnings.forEach((msg)=> console.warn(`WARN: ${msg}`));
} else {
  console.log('OK: fan-out warning validator passed with no warnings.');
}
process.exit(0);
