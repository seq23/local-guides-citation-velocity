#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function readJson(rel, fallback=null){const p=path.join(ROOT,rel); if(!fs.existsSync(p)) return fallback; return JSON.parse(fs.readFileSync(p,'utf8'));}
function writeJson(rel,payload){const p=path.join(ROOT,rel); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,JSON.stringify(payload,null,2)+'\n');}
function has(rel){return fs.existsSync(path.join(ROOT,rel));}
function main(){
 const errors=[];
 const profile=readJson('data/strategy/citation_strategy_profile.json',{});
 const contract=readJson('_content_release_contract.json',{});
 const plan=readJson('artifacts/validation/daily-citation-release-plan.json',{});
 const proof=readJson('artifacts/validation/daily-proof-packet.json',{});
 const trace=readJson('artifacts/validation/fixture-signal-trace.json',{});
 const app=readJson('artifacts/validation/daily-citation-release-application.json',{});
 const wf=has('.github/workflows/daily-citation-intelligence.yml') ? fs.readFileSync(path.join(ROOT,'.github/workflows/daily-citation-intelligence.yml'),'utf8') : '';
 const daily=Number(profile.cadence?.daily_target_units||0);
 if(daily<5 || daily>10) errors.push(`Velocity controlled cadence must be 5-10 units/day; found ${daily}`);
 if(profile.signal_strategy?.default_mode !== 'SHADOW_MODE') errors.push('default signal mode must remain SHADOW_MODE');
 if(contract.controlled_apply?.public_content_mutation_enabled !== false) errors.push('public content mutation must remain disabled for container-controlled release');
 if(trace.status !== 'PASS') errors.push('fixture trace must pass before controlled release readiness');
 if(!plan.selected_count && !(plan.selected||[]).length) errors.push('release plan must select at least one unit');
 if(!plan.blocked_count && !(plan.blocked||[]).length) errors.push('release plan must include blocked/not-selected units');
 if(proof.external_telemetry_present !== false) errors.push('proof packet must state external telemetry is absent');
 if(!String(proof.status||'').includes('PASS')) errors.push('daily proof packet must pass structurally');
 if(app.public_content_mutation_enabled !== false) errors.push('application proof must remain shadow/no-op in container');
 if(!wf.includes('schedule:') || !wf.includes('17 13 * * *')) errors.push('Velocity daily citation workflow schedule must be present at cron 17 13 * * *');
 if(!wf.includes('permissions:\n  contents: read')) errors.push('daily workflow must not have contents: write');
 if(!has('artifacts/validation/browserless-mock-audit.json') && !has('artifacts/validation/mock-browser-backup.json')) errors.push('browserless mock backup proof is required before scheduling in container');
 const report={schema_version:'1.0',repo:'local-guides-citation-velocity',validator:'controlled-release-readiness',generated_at:new Date().toISOString(),status:errors.length?'FAIL':'PASS',cadence_class:'CADENCE_DAILY_LIGHT',daily_target_units:daily,public_content_mutation_enabled:false,scheduled_workflow_enabled:true,local_browser_validation:'REQUIRED_NOT_RUN',external_telemetry_present:false,errors};
 writeJson('artifacts/validation/controlled-release-readiness.json',report);
 fs.mkdirSync(path.join(ROOT,'reports'),{recursive:true});
 fs.writeFileSync(path.join(ROOT,'reports/controlled-release-readiness.md'),`# Controlled Release Readiness\n\nStatus: ${report.status}\n\nCadence: ${report.cadence_class} (${daily} units/day)\n\nPublic content mutation enabled: false\n\nDaily schedule enabled: true\n\nLocal browser/updater validation: REQUIRED_NOT_RUN\n`);
 if(errors.length){console.error(errors.join('\n')); process.exit(1);} console.log('controlled release readiness PASS');
}
main();
