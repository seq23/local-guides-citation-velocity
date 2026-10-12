#!/usr/bin/env node
'use strict';
// Proves the brand-separation scan (scripts/lib/brand_separation.js, run by the
// canonical-domains validator) passes a clean tree and fails each way it can break.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { checkBrandSeparation, LEAD_FROM_PIN, WEEKLY_REPORT, WEEKLY_FROM_PIN } = require('../lib/brand_separation');

const HANDLER = `${LEAD_FROM_PIN}\nexport async function onRequestPost(){ const from = LEAD_FROM; return from; }\n`;
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-sep-'));
  for (const [rel, text] of Object.entries(files)) {
    if (text === undefined) continue;
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const HANDLER_SEND = HANDLER + "// posts to https://api.resend.com/emails\n";
const WEEKLY = `${WEEKLY_FROM_PIN}\nTO = "sequoia@westpeek.ventures"   # owner inbox\nURL = "https://api.resend.com/emails"\n`;
const WF = 'on: workflow_dispatch\njobs: {}\n';
const clean = { 'dist/index.html': '<p>The Industry Guides</p>', 'functions/api/request-assistance.js': HANDLER_SEND, [WEEKLY_REPORT]: WEEKLY, '.github/workflows/w.yml': WF };
const cases = [
  ['clean tree passes', clean, true],
  ['forbidden sender in a function fails', { ...clean, 'functions/api/x.js': "const f='hello@joinwestpeek.com';" }, false],
  ['forbidden name in dist fails', { ...clean, 'dist/feed.xml': '<author>Spry Labs</author>' }, false],
  ['spryvc.com in dist fails', { ...clean, 'dist/llms.txt': 'contact info@spryvc.com' }, false],
  ['handler reading env.EMAIL_FROM fails', { ...clean, 'functions/api/request-assistance.js': HANDLER.replace('= LEAD_FROM', '= env.EMAIL_FROM || LEAD_FROM') }, false],
  ['handler without the pinned sender fails', { ...clean, 'functions/api/request-assistance.js': 'export const x=1;' }, false],
  ['zero dist files fails', { ...clean, 'dist/index.html': undefined }, false],
  ['zero function files fails', { ...clean, 'functions/api/request-assistance.js': undefined }, false],
  ['weekly report From on westpeek.ventures fails', { ...clean, [WEEKLY_REPORT]: WEEKLY.replace(WEEKLY_FROM_PIN, 'FROM = "os@westpeek.ventures"') }, false],
  ['weekly report without the pinned sender fails', { ...clean, [WEEKLY_REPORT]: WEEKLY.replace(WEEKLY_FROM_PIN, 'FROM = "x@theindustryguides.com"') }, false],
  ['weekly report reading the sender from env fails', { ...clean, [WEEKLY_REPORT]: WEEKLY + 'FROM2 = os.environ.get("EMAIL_FROM")\n' }, false],
  ['joinwestpeek.com in a workflow fails', { ...clean, '.github/workflows/w.yml': WF + '# from: hello@joinwestpeek.com\n' }, false],
  ['spryvc.com sender in a sending script fails', { ...clean, 'scripts/x/send.mjs': "fetch('https://api.resend.com/emails',{body:JSON.stringify({from:'a@spryvc.com'})})" }, false],
  ['missing weekly report fails', { ...clean, [WEEKLY_REPORT]: undefined, 'scripts/s.py': 'u="https://api.resend.com"' }, false],
  ['zero workflow files fails', { ...clean, '.github/workflows/w.yml': undefined }, false],
  ['zero sending files fails', { 'dist/index.html': '<p>ok</p>', 'functions/api/request-assistance.js': HANDLER, [WEEKLY_REPORT]: WEEKLY_FROM_PIN + '\n', '.github/workflows/w.yml': WF }, false],
];
for (const [name, files, expectOk] of cases) {
  const root = tree(files);
  const res = checkBrandSeparation({ root });
  assert.strictEqual(res.ok, expectOk, `${name}: expected ok=${expectOk}, got ${JSON.stringify(res.failures)}`);
  fs.rmSync(root, { recursive: true, force: true });
}
console.log(`brand separation: ${cases.length}/${cases.length} cases pass`);
