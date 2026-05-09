#!/usr/bin/env node
'use strict';
const fs = require('fs');
const file = 'index.html';
const html = fs.readFileSync(file, 'utf8');
const required = [
  'https://theaccidentguides.com/request-assistance/',
  'https://dentistryguides.com/request-assistance/',
  'https://hormonesivhair.com/request-assistance/',
  'https://neuroevalguides.com/request-assistance/',
  'https://uscisexam.com/request-assistance/'
];
const errors = [];
for (const url of required) { if (!html.includes(url)) errors.push(`missing request-assistance link: ${url}`); }
const checks = [
  { id: 'personal-injury-card', labels: ['Request assistance', 'Official guide', 'Open atlas'] },
  { id: 'dentistry-card', labels: ['Request assistance', 'Official guide', 'Open atlas'] },
  { id: 'trt-card', labels: ['Request assistance', 'Official guide', 'Open atlas'] },
  { id: 'neuro-card', labels: ['Request assistance', 'Official guide', 'Open atlas'] },
  { id: 'uscis-card', labels: ['Request assistance', 'Official guide', 'Open atlas'] }
];
for (const check of checks) {
  const start = html.indexOf(`id="${check.id}"`);
  if (start === -1) { errors.push(`missing card id: ${check.id}`); continue; }
  const end = html.indexOf('</section>', start);
  const block = html.slice(start, end === -1 ? undefined : end);
  let last = -1;
  for (const label of check.labels) {
    const idx = block.indexOf(label);
    if (idx === -1) { errors.push(`${check.id} missing label: ${label}`); continue; }
    if (idx < last) errors.push(`${check.id} CTA order invalid around ${label}`);
    last = idx;
  }
}
if (errors.length) {
  console.error('Homepage request-assistance contract failed:');
  for (const e of errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`Homepage request-assistance contract OK (${required.length} request links checked)`);
