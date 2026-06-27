#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'../..');
function readJson(p,f=null){try{return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}catch{return f}}
function writeJson(p,v){const out=path.join(ROOT,p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n')}
const policy=readJson('data/report_fixes/agent_exact_implementation_policy.json',null);
const plan=readJson('artifacts/validation/agent-exact-implementation-plan.json',null);
const trace=readJson('artifacts/validation/agent-exact-implementation-trace.json',null);
const errors=[];
if(!policy) errors.push('missing_policy');
if(policy && policy.retroactive_processing!==false) errors.push('policy_must_be_forward_only');
if(!plan) errors.push('missing_plan');
if(!trace) errors.push('missing_trace');
if(trace && trace.status!=='PASS') errors.push('trace_not_pass');
if(plan && (plan.specs||[]).some(s=>s.operation==='REPAIR_INTENDED_WINNER_PAGE' && s.status==='PLANNED') && !trace) errors.push('planned_repairs_without_trace');
const report={schema_version:'1.0', status:errors.length?'FAIL':'PASS', checked_at:process.env.SOURCE_DATE||new Date().toISOString().slice(0,10), policy_path:'data/report_fixes/agent_exact_implementation_policy.json', plan_count:plan?.specs?.length||0, errors};
writeJson('artifacts/validation/agent-exact-implementation.json', report);
if(errors.length){console.error('AGENT EXACT IMPLEMENTATION VALIDATION FAIL');errors.forEach(e=>console.error(`- ${e}`));process.exit(1)}
console.log(`AGENT EXACT IMPLEMENTATION VALIDATION PASS: specs=${report.plan_count}`);
