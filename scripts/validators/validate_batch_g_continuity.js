#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const must = [
  'artifacts/validation/strategy-gap-fill-contract.json',
  'artifacts/validation/generated-content-finalization-contract.json',
  'artifacts/validation/rich-new-page-contract.json',
  'artifacts/validation/agent-artifact-continuity.json',
  'data/strategy/strategy_gap_fill_backlog.json',
  'data/strategy/generated_content_finalization_contract.json'
];
const errors = [];
for (const rel of must) if (!fs.existsSync(path.join(ROOT, rel))) errors.push(`missing:${rel}`);
function read(rel){ return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8')); }
if (!errors.length) {
  for (const rel of ['artifacts/validation/strategy-gap-fill-contract.json','artifacts/validation/generated-content-finalization-contract.json','artifacts/validation/rich-new-page-contract.json']) {
    const payload = read(rel);
    if (payload.status !== 'PASS') errors.push(`not_pass:${rel}:${payload.status}`);
  }
  const backlog = read('data/strategy/strategy_gap_fill_backlog.json');
  if ((backlog.candidates || []).length < (backlog.minimum_units || 0)) errors.push(`backlog_under_minimum:${(backlog.candidates || []).length}/${backlog.minimum_units}`);
}
const report = {schema_version:'1.0', validator:'batch-g-continuity-contract', status:errors.length?'FAIL':'PASS', checked_files:must, errors};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'), {recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/batch-g-continuity-contract.json'), JSON.stringify(report,null,2)+'\n');
if (errors.length) { console.error(JSON.stringify(report,null,2)); process.exit(1); }
console.log('BATCH G CONTINUITY CONTRACT PASS');
