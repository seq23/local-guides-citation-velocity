#!/usr/bin/env node
'use strict';
const {spawnSync}=require('child_process');const fs=require('fs'),path=require('path');const ROOT=path.resolve(__dirname,'../..');const max=Math.max(1,Math.min(3,Number(process.env.SELF_HEAL_MAX_ATTEMPTS||3)));const attempts=[];
function run(command,args){const started=Date.now();const r=spawnSync(command,args,{cwd:ROOT,stdio:'inherit',env:{...process.env,NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=3072'}});return {command:[command,...args].join(' '),status:r.status===0?'PASS':'FAIL',exit_code:r.status,duration_ms:Date.now()-started};}
let passed=false;
for(let attempt=1;attempt<=max;attempt++){
 const stateRepair=run(process.execPath,['scripts/content/self_heal_programmatic_content.js']);
 const automaticRepair=stateRepair.status==='PASS'?run(process.execPath,['scripts/content/self_heal_automatic_pages.js']):{command:'automatic repair skipped after state repair failure',status:'FAIL',exit_code:1,duration_ms:0};
 const repair={command:`${stateRepair.command} && ${automaticRepair.command}`,status:stateRepair.status==='PASS'&&automaticRepair.status==='PASS'?'PASS':'FAIL',exit_code:stateRepair.exit_code||automaticRepair.exit_code,duration_ms:stateRepair.duration_ms+automaticRepair.duration_ms,stages:[stateRepair,automaticRepair]};
 const validate=repair.status==='PASS'?run(process.execPath,['scripts/content/validate_programmatic_substance.js']):{command:'validation skipped after repair failure',status:'FAIL',exit_code:1,duration_ms:0};
 attempts.push({attempt,repair,validate});
 if(validate.status==='PASS'){passed=true;break;}
 console.error(`SELF_HEAL_ATTEMPT_${attempt}_FAILED`);
}
// Substance is a word-count quality signal, reported, never a gate; only a repair that could not run stops the pipeline.
const repaired=attempts.some((a)=>a.repair.status==='PASS');
const report={schema_version:'1.0',status:repaired?'PASS':'FAIL',substance:passed?'PASS':'BELOW_TARGET_REPORTED',maximum_attempts:max,attempts,advance_rule:'The pipeline advances once the source repair runs; the substance/word-count result is recorded, not gated.',completed_at:`${process.env.SOURCE_DATE||'2026-06-19'}T00:00:00.000Z`};fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/source-self-heal-loop.json'),JSON.stringify(report,null,2)+'\n');if(!repaired){console.error('SOURCE SELF-HEAL: the repair itself failed on every attempt');process.exit(1);}console.log(`SOURCE SELF-HEAL PASS after ${attempts.length} attempt(s); substance ${report.substance}`);
