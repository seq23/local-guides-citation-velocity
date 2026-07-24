#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');const ROOT=path.resolve(__dirname,'../..');
function readJson(rel,fallback=null){const p=path.join(ROOT,rel);if(!fs.existsSync(p))return fallback;return JSON.parse(fs.readFileSync(p,'utf8'));}
function writeJson(rel,payload){const p=path.join(ROOT,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(payload,null,2)+'\n');}
function has(rel){return fs.existsSync(path.join(ROOT,rel));}
function main(){
 const errors=[];const profile=readJson('data/strategy/citation_strategy_profile.json',{});const contract=readJson('_content_release_contract.json',{});const plan=readJson('artifacts/validation/daily-citation-release-plan.json',{});const proof=readJson('artifacts/validation/daily-proof-packet.json',{});const trace=readJson('artifacts/validation/fixture-signal-trace.json',{});const app=readJson('artifacts/validation/daily-citation-release-application.json',{});const wf=has('.github/workflows/daily-citation-intelligence.yml')?fs.readFileSync(path.join(ROOT,'.github/workflows/daily-citation-intelligence.yml'),'utf8'):'';
 const daily=Number(profile.cadence?.daily_processing_budget_units||profile.cadence?.daily_target_units||0);
 if(daily<1||daily>10)errors.push(`daily processing budget must be 1-10 units; found ${daily}`);
 if(profile.cadence?.publication_quota!==false)errors.push('daily cadence must not be a publication quota');
 if(profile.signal_strategy?.default_mode!=='SHADOW_MODE')errors.push('daily citation-intelligence signal mode must remain SHADOW_MODE');
 if(contract.runtime_autonomy_model!=='FULL_SAFE_AUTONOMY')errors.push('content runtime must declare FULL_SAFE_AUTONOMY');
 if(contract.controlled_apply?.public_content_mutation_enabled!==true)errors.push('governed Safe Harbor content mutation must be enabled in the content release lane');
 if(contract.safe_harbor?.routine_human_approval_required!==false)errors.push('routine owner approval must be disabled');
 if(trace.status!=='PASS')errors.push('fixture trace must pass before controlled intelligence readiness');
 if(!plan.selected_count&&!(plan.selected||[]).length)errors.push('release planning proof must select at least one candidate unit');
 if(proof.external_telemetry_present!==false)errors.push('proof packet must state external telemetry is absent');
 if(!String(proof.status||'').includes('PASS'))errors.push('daily proof packet must pass structurally');
 // The daily citation-intelligence application remains planning-only even though
 // the separate governed content-release lane can safely publish.
 if(app&&Object.keys(app).length){
   if(app.public_content_mutation_enabled!==false)errors.push('daily citation-intelligence application proof must remain planning-only/no-public-mutation');
   if(Number(app.release_units_applied||0)!==0)errors.push('daily citation-intelligence planning lane must apply zero public release units');
   if(app.governed_release_public_mutation_enabled!==true)errors.push('planning proof must distinguish governed release mutation capability from planning-lane mutation');
   if((app.applied||[]).some((row)=>row.status!=='PLANNING_ONLY_RECORDED'))errors.push('daily citation-intelligence application contains non-planning disposition');
 }
 if(!wf.includes('schedule:')||!wf.includes('17 13 * * *'))errors.push('daily citation intelligence schedule must remain present at cron 17 13 * * *');
 if(!wf.includes('permissions:\n  contents: read'))errors.push('daily citation-intelligence workflow must remain read-only');
 if(!has('artifacts/validation/browserless-mock-audit.json')&&!has('artifacts/validation/mock-browser-backup.json'))errors.push('browserless mock backup proof is required before scheduling in container');
 const date=process.env.SOURCE_DATE||new Date().toISOString().slice(0,10);const report={schema_version:'2.0',repo:'local-guides-citation-velocity',validator:'controlled-release-readiness',generated_at:`${date}T00:00:00.000Z`,status:errors.length?'FAIL':'PASS',cadence_class:'CADENCE_DAILY_LIGHT_SAFE_HARBOR',daily_processing_budget_units:daily,publication_quota:false,daily_intelligence_public_mutation_enabled:false,governed_content_release_public_mutation_enabled:true,runtime_autonomy:'FULL_SAFE_AUTONOMY',scheduled_workflow_enabled:true,local_browser_validation:'REQUIRED_NOT_RUN',external_telemetry_present:false,errors};
 writeJson('artifacts/validation/controlled-release-readiness.json',report);fs.mkdirSync(path.join(ROOT,'reports'),{recursive:true});fs.writeFileSync(path.join(ROOT,'reports/controlled-release-readiness.md'),`# Controlled Release Readiness\n\nStatus: ${report.status}\n\nDaily processing budget: ${daily} units/day maximum; not a publication quota.\n\nDaily citation-intelligence lane: read-only / shadow proof.\n\nGoverned content release lane: FULL SAFE AUTONOMY with Safe Harbor + transactional freeze boundaries.\n\nLocal browser/updater validation: REQUIRED_NOT_RUN\n`);
 if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log('controlled release readiness PASS');
}
main();
