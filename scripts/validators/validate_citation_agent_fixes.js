#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'../..');const errors=[];const warnings=[];
function readJson(rel,fb=null){const p=path.join(ROOT,rel);if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'));}
function exists(rel){return fs.existsSync(path.join(ROOT,rel));}
const ledger=readJson('data/report_fixes/agent_fix_ledger.json',{fixes:[]});
if(!Array.isArray(ledger.fixes))errors.push('agent_fix_ledger:fices_not_array');
const plan=readJson('artifacts/validation/velocity-intake-release-plan.json',null);
if(plan){if(plan.selected_count<=0)errors.push('velocity_intake_release_plan:selected_count_zero');if(plan.selected_count!==plan.agent_selected_count+plan.social_fallback_selected_count)errors.push('velocity_intake_release_plan:count_mismatch');if(plan.selected_count>150)errors.push('velocity_intake_release_plan:exceeds_max_150');}
else warnings.push('velocity_intake_release_plan_missing');
for(const fix of ledger.fixes||[]){if(!fix.id)errors.push('agent_fix_ledger:fix_missing_id');if(!fix.query)errors.push(`${fix.id}:missing_query`);if(!fix.vertical)errors.push(`${fix.id}:missing_vertical`);if(!fix.implementation_status)errors.push(`${fix.id}:missing_implementation_status`);if(fix.trace_required){for(const k of ['sourceFiles','liveManifestPath','stagedManifestPath','renderedPath','required_markers'])if(!fix[k]||(Array.isArray(fix[k])&&!fix[k].length))errors.push(`${fix.id}:trace_required_missing_${k}`);}}
if(exists('data/report_fixes/agent_runs')){
 const intake=readJson('artifacts/validation/agent-run-artifact-intake.json',null)||readJson('artifacts/validation/agent-run-intake.json',null);if(!intake)warnings.push('agent_run_intake_evidence_missing');else if(intake.status&&intake.status!=='PASS')errors.push('agent_run_intake_not_pass');
}
const pkg=readJson('package.json',{});for(const script of ['apply:citation-agent-fixes','trace:citation-agent-fixes','validate:citation-agent-fixes','release:velocity-intake'])if(!pkg.scripts||!pkg.scripts[script])errors.push(`package_missing_script:${script}`);
const report={schema_version:'1.0',validator:'citation-agent-fixes',status:errors.length?'FAIL':'PASS',fix_count:(ledger.fixes||[]).length,plan_selected_count:plan&&plan.selected_count||0,errors,warnings,checked_at:process.env.SOURCE_DATE||new Date().toISOString().slice(0,10)};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/citation-agent-fixes.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error('CITATION AGENT FIXES FAIL');errors.forEach(e=>console.error(`- ${e}`));process.exit(1);}console.log(`CITATION AGENT FIXES PASS: ${(ledger.fixes||[]).length} cumulative fix(es).`);
