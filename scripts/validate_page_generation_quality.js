#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { belowHardFloor, hardFloor } = require('./lib/floor_rule');
// 120 words is the target; a page fails only below 75% of it (owner ruling 2 Nov 2026).
const MIN_WORDS = 120;

const ROOT = path.resolve(__dirname, '..');
const dir = path.join(ROOT,'insights');
const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];

const errors = [];

for (const f of files) {
  if (!f.endsWith('.html')) continue;
  const p = path.join(dir,f);
  const html = fs.readFileSync(p,'utf8');

  if (!/<title>/.test(html)) errors.push(f+" no title");
  if (!/<h1/.test(html)) errors.push(f+" no h1");
  if (!/meta name="description"/.test(html)) errors.push(f+" no meta");
  if (!/top/.test(html)) errors.push(f+" no top marker");
  if (!/bottom/.test(html)) errors.push(f+" no bottom marker");

  const wc = html.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
  if (belowHardFloor(wc, MIN_WORDS)) errors.push(`${f} too short: ${wc} words < ${hardFloor(MIN_WORDS)} (75% of ${MIN_WORDS})`);
}

if (errors.length){
  console.error("PAGE QUALITY FAIL");
  errors.forEach(e=>console.error(e));
  process.exit(1);
}

console.log("PAGE QUALITY PASS");
