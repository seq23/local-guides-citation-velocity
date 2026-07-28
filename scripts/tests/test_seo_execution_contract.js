'use strict';
const assert=require('assert'); const {normalizeSeoExecution}=require('../lib/seo_execution_contract');
const real=require('../../data/report_fixes/agent_runs/2026-07-27/personal-injury/personal-injury.json');
assert.strictEqual(real.seo_execution.length,5); assert.strictEqual(real.pages_to_build.length,7); assert.strictEqual(real.site_health,null);
const normalized=real.seo_execution.map(normalizeSeoExecution); assert.strictEqual(normalized.filter(x=>x.status==='VALID').length,4); assert.strictEqual(normalized.filter(x=>x.errors.includes('self_link')).length,1);
assert.ok(normalized.every(x=>x.value.scope==='personal_injury')); assert.ok(normalized.every(x=>Array.isArray(x.value.acceptance_checks)));
console.log('seo-execution-contract-test: PASS');
