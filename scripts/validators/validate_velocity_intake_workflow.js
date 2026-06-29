#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'../..');const errors=[];const warnings=[];
function has(txt,needle){return txt.includes(needle);}function read(rel){return fs.readFileSync(path.join(ROOT,rel),'utf8');}
const workflowRel='.github/workflows/velocity_content_release.yml';
const wf=read(workflowRel);
const pkg=JSON.parse(read('package.json'));
const registry=JSON.parse(read('data/workflows/workflow_contract_registry.json'));
for(const token of ['data/report_fixes/agent_runs/**/agent_run_manifest.json','cron: "15 18 * * 1-5"','npm run release:velocity-intake','git push origin HEAD:main','contents: write','node-version: "24"']){if(!has(wf,token))errors.push(`${workflowRel}:missing:${token}`);}
if(fs.existsSync(path.join(ROOT,'.github/workflows/agent_run_absorption.yml')))errors.push('separate_agent_run_absorption_workflow_present; use consolidated velocity_content_release.yml');
for(const script of ['validate:agent-run-intake','citation:prepare-velocity-intake','citation:apply-html-report-contract','validate:html-report-contract','release:velocity-intake','validate:velocity-intake-workflow']){if(!pkg.scripts||!pkg.scripts[script])errors.push(`package_missing_script:${script}`);}
const entry=(registry.workflows||[]).find(w=>w.file==='velocity_content_release.yml');
if(!entry)errors.push('workflow_registry_missing_velocity_content_release');
else{
 for(const token of ['push:agent_run_manifest','schedule:weekday-after-noon-ct','workflow_dispatch'])if(!(entry.triggers||[]).includes(token))errors.push(`workflow_registry_velocity_missing_trigger:${token}`);
 for(const cmd of ['npm run release:velocity-intake','npm run release:self-healing'])if(!(entry.commands||[]).includes(cmd))errors.push(`workflow_registry_velocity_missing_command:${cmd}`);
 const intakeScript=String((pkg.scripts||{})['release:velocity-intake']||'');for(const token of ['citation:apply-html-report-contract','validate:html-report-contract'])if(!has(intakeScript,token))errors.push(`release_velocity_intake_missing:${token}`);
 for(const consumed of ['Twin Agent ready manifests','social/public backlog'])if(!JSON.stringify(entry.consumes||[]).includes(consumed))errors.push(`workflow_registry_velocity_missing_consume:${consumed}`);
}
const files=fs.readdirSync(path.join(ROOT,'.github/workflows')).filter(f=>/\.ya?ml$/.test(f)).sort();const registered=(registry.workflows||[]).map(w=>w.file).sort();
if(JSON.stringify(files)!==JSON.stringify(registered))errors.push(`workflow_inventory_mismatch:${files.join(',')}!=${registered.join(',')}`);
const report={schema_version:'1.0',validator:'velocity-intake-workflow',status:errors.length?'FAIL':'PASS',workflow:workflowRel,errors,warnings,checked_at:process.env.SOURCE_DATE||new Date().toISOString().slice(0,10)};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/velocity-intake-workflow.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error('VELOCITY INTAKE WORKFLOW FAIL');errors.forEach(e=>console.error(`- ${e}`));process.exit(1);}console.log('VELOCITY INTAKE WORKFLOW PASS');
