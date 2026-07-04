#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const pkg = readJson('package.json');
const contract = readJson('data/strategy/generated_content_finalization_contract.json');
const scripts = pkg.scripts || {};
const errors = [];
function mustScript(name, fragments) {
  const cmd = scripts[name] || '';
  if (!cmd) { errors.push(`missing_script:${name}`); return; }
  for (const fragment of fragments) if (!cmd.includes(fragment)) errors.push(`script_missing_fragment:${name}:${fragment}`);
}
mustScript('release:content-finalize', [
  'content:self-heal',
  'validate:programmatic-substance',
  'npm run build',
  'validate:rendered-programmatic',
  'validate:rich-new-page-contract',
  'validate:page-family-contract'
]);
mustScript('release:velocity-content', [
  'strategy:gap-fill:backlog',
  'strategy:gap-fill:release-gap',
  'release:velocity-content:raw',
  'release:content-finalize'
]);
mustScript('release:velocity-intake', [
  'release:velocity-content',
  'citation:apply-agent-exact',
  'release:content-finalize'
]);
for (const field of ['required_finish_sequence','forbidden_finish_states','finish_command']) if (!(field in contract)) errors.push(`contract_missing:${field}`);
for (const rel of ['artifacts/validation/programmatic-substance.json','artifacts/validation/rich-new-page-contract.json','artifacts/validation/page-family-contract.json']) {
  if (!fs.existsSync(path.join(ROOT, rel))) errors.push(`evidence_missing:${rel}`);
}
const report = {schema_version:'1.0', validator:'generated-content-finalization-contract', status:errors.length?'FAIL':'PASS', checked_scripts:['release:content-finalize','release:velocity-content','release:velocity-intake'], errors};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/generated-content-finalization-contract.json'), JSON.stringify(report,null,2)+'\n');
if (errors.length) { console.error(JSON.stringify(report,null,2)); process.exit(1); }
console.log('GENERATED CONTENT FINALIZATION CONTRACT PASS');
