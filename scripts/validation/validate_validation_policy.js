#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const {classifyResult}=require('./policy');
const ROOT=path.resolve(__dirname,'../..');
const cases=[
  ['hard-pass',{severity:'HARD_FAIL'},'PASS',false],
  ['hard-fail',{severity:'HARD_FAIL',nonzero:true},'FAIL',true],
  ['hard-timeout',{severity:'HARD_FAIL',nonzero:true,timedOut:true},'TIMEOUT',true],
  ['hard-warning-text',{severity:'HARD_FAIL',warningFound:true},'PASS_WITH_WARNINGS',false],
  ['strong-default',{severity:'STRONG_WARNING',warningFound:true},'STRONG_WARNING',false],
  ['strong-strict',{severity:'STRONG_WARNING',warningFound:true,strictWarnings:true},'STRONG_WARNING',true],
  ['soft-nonzero',{severity:'SOFT_WARNING',nonzero:true},'SOFT_WARNING',false],
  ['info-nonzero',{severity:'INFO',nonzero:true},'INFO_FINDING',false]
];
const errors=[];
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'_validation_registry.json'),'utf8'));
const neverHardFail=registry.release_blocking_policy?.never_hard_fail_categories||[];
for(const category of ['trailing whitespace','blank lines','indentation','cosmetic formatting'])if(!neverHardFail.includes(category))errors.push(`missing_nonblocking_category:${category}`);
for(const [name,input,status,blocks] of cases){const actual=classifyResult(input);if(actual.status!==status||actual.blocks!==blocks)errors.push(`${name}: expected ${status}/${blocks}, got ${actual.status}/${actual.blocks}`);}
const report={validator:'validation-policy',ok:errors.length===0,case_count:cases.length,cosmetic_nonblocking_categories:neverHardFail,errors};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/validation-policy.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`VALIDATION POLICY PASS (${cases.length} cases)`);
