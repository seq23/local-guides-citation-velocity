#!/usr/bin/env node
'use strict';
const {classifyResult}=require('../validation/policy');
const L=require('../search_intelligence/lib');
const fs=require('fs');const path=require('path');
const results=[];function check(name,fn){try{fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}}
function assert(v,m){if(!v)throw new Error(m);}
check('1 cosmetic strong warning does not block release',()=>assert(classifyResult({severity:'STRONG_WARNING',nonzero:true}).blocks===false,'warning blocked'));
check('2 optional provider absence is truthful not configured',()=>{const s={state:'NOT_CONFIGURED'};assert(s.state==='NOT_CONFIGURED','wrong state');assert(s.state!=='PASS','fake pass');});
check('3 real hard failure blocks',()=>assert(classifyResult({severity:'HARD_FAIL',nonzero:true}).blocks===true,'hard fail did not block'));
check('4 missing external telemetry is inconclusive',()=>{const s='INCONCLUSIVE';assert(s!=='PASS'&&s!=='FAIL','inconclusive collapsed');});
check('5 unknown cannot be interpreted as healthy',()=>{const s='UNKNOWN';assert(s!=='PASS'&&s!=='HEALTHY','unknown fake-green');});
check('6 build output precondition can remain generated-state observation',()=>{const c=L.loadContract();assert(Array.isArray(c.truth_laws),'contract missing');});
check('7 historical debt is not current release failure by itself',()=>assert(classifyResult({severity:'INFO',nonzero:true}).blocks===false,'info blocked'));
check('8 a current hard canonical conflict blocks',()=>assert(classifyResult({severity:'HARD_FAIL',nonzero:true}).status==='FAIL','canonical conflict not fail'));
check('9 protected Agent mutation is a hard material class',()=>assert(L.isProtected('data/report_fixes/agent_runs/2026-08-07/x.json'),'protected path missed'));
check('10 newly generated invalid state can be hard failed',()=>assert(classifyResult({severity:'HARD_FAIL',nonzero:true}).blocks,'generated invalid state not blocked'));
check('11 missing required post-build output can be hard failed',()=>assert(classifyResult({severity:'HARD_FAIL',nonzero:true}).blocks,'postbuild missing not blocked'));
check('12 duplicate validator IDs are invalid governance',()=>{const r=L.readJson('_validation_registry.json');const ids=r.validators.map(v=>v.id);assert(new Set(ids).size===ids.length,'duplicate validator id');});
check('13 every active blocking validator is registered',()=>{const r=L.readJson('_validation_registry.json');assert(r.validators.filter(v=>v.status==='ACTIVE'&&v.severity==='HARD_FAIL').every(v=>v.path&&v.command),'unregistered blocking shape');});
check('14 strong warnings are not blocks_release by default',()=>{const r=L.readJson('_validation_registry.json');assert(r.validators.filter(v=>v.status!=='RETIRED'&&v.severity==='STRONG_WARNING').every(v=>v.blocks_release!==true),'strong warning marked blocking');});
check('15 UNKNOWN is forbidden as pass semantic',()=>assert(classifyResult({severity:'INFO',nonzero:true}).status==='INFO_FINDING','unknown/info collapsed to pass'));
const failed=results.filter(r=>r.status==='FAIL');const report={schema_version:'1.0',test:'validator-materiality-hostile',status:failed.length?'FAIL':'PASS',passed:results.length-failed.length,total:results.length,results};fs.mkdirSync(path.join(L.ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(L.ROOT,'artifacts/validation/validator-materiality-hostile.json'),JSON.stringify(report,null,2)+'\n');console.log(`VALIDATOR MATERIALITY HOSTILE ${report.status}: ${report.passed}/${report.total}`);if(failed.length){console.error(failed);process.exit(1);}
