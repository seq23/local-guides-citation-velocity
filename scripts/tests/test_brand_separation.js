#!/usr/bin/env node
'use strict';
// Proves the brand-separation scan (scripts/lib/brand_separation.js, run by the
// canonical-domains validator) passes a clean tree and fails each way it can break.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { checkBrandSeparation, LEAD_FROM_PIN } = require('../lib/brand_separation');

const HANDLER = `${LEAD_FROM_PIN}\nexport async function onRequestPost(){ const from = LEAD_FROM; return from; }\n`;
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-sep-'));
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const clean = { 'dist/index.html': '<p>The Industry Guides</p>', 'functions/api/request-assistance.js': HANDLER };
const cases = [
  ['clean tree passes', clean, true],
  ['forbidden sender in a function fails', { ...clean, 'functions/api/x.js': "const f='hello@joinwestpeek.com';" }, false],
  ['forbidden name in dist fails', { ...clean, 'dist/feed.xml': '<author>Spry Labs</author>' }, false],
  ['spryvc.com in dist fails', { ...clean, 'dist/llms.txt': 'contact info@spryvc.com' }, false],
  ['handler reading env.EMAIL_FROM fails', { ...clean, 'functions/api/request-assistance.js': HANDLER.replace('= LEAD_FROM', '= env.EMAIL_FROM || LEAD_FROM') }, false],
  ['handler without the pinned sender fails', { ...clean, 'functions/api/request-assistance.js': 'export const x=1;' }, false],
  ['zero dist files fails', { 'functions/api/request-assistance.js': HANDLER }, false],
  ['zero function files fails', { 'dist/index.html': '<p>ok</p>' }, false],
];
for (const [name, files, expectOk] of cases) {
  const root = tree(files);
  const res = checkBrandSeparation({ root });
  assert.strictEqual(res.ok, expectOk, `${name}: expected ok=${expectOk}, got ${JSON.stringify(res.failures)}`);
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`brand separation: ${cases.length}/${cases.length} cases pass`);
