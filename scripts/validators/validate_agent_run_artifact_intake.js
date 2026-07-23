#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const RUN_ROOT = path.join(ROOT, 'data/report_fixes/agent_runs');
const allowedStatuses = new Set(['READY_FOR_ABSORPTION', 'IMPORTED', 'ABSORBED', 'QUARANTINED']);
const allowedVerticals = new Set(['dentistry', 'personal-injury', 'personal_injury', 'pi', 'uscis', 'uscis-medical', 'neuro', 'trt', 'peptides', 'hair-loss']);
const errors = [];
const warnings = [];
const manifests = [];
let quarantinedCount = 0;
let activeManifestCount = 0;
function rel(p){return path.relative(ROOT,p).replace(/\\/g,'/');}
function readJson(abs){return JSON.parse(fs.readFileSync(abs,'utf8'));}
function walk(abs){if(!fs.existsSync(abs))return;for(const e of fs.readdirSync(abs,{withFileTypes:true})){const p=path.join(abs,e.name);if(e.isDirectory())walk(p);else if(e.name==='agent_run_manifest.json')manifests.push(p);}}
function parseHeader(csvAbs){const text=fs.readFileSync(csvAbs,'utf8').replace(/^\uFEFF/,'');let field='',headers=[],inQuotes=false;for(let i=0;i<text.length;i++){const ch=text[i],next=text[i+1];if(ch==='"'){if(inQuotes&&next==='"'){field+='"';i++;}else inQuotes=!inQuotes;}else if(ch===','&&!inQuotes){headers.push(field.trim());field='';}else if((ch==='\n'||ch==='\r')&&!inQuotes){headers.push(field.trim());break;}else field+=ch;}return headers.filter(Boolean);}
function isUnresolvedLocalFetch(abs){if(!fs.existsSync(abs))return false;const text=fs.readFileSync(abs,'utf8').trim();return /^\{\s*"_fetchBase64"\s*:\s*"local:\/\/agent\/current\/generated\//.test(text);}
walk(RUN_ROOT);
for(const manifestAbs of manifests){const manifestRel=rel(manifestAbs);let m;try{m=readJson(manifestAbs);}catch(e){errors.push(`${manifestRel}:invalid_json:${e.message}`);continue;}
 for(const k of ['source','run_date','vertical','csv_path','html_path','status'])if(!m[k])errors.push(`${manifestRel}:missing:${k}`);
 if(m.run_date&&!/^\d{4}-\d{2}-\d{2}$/.test(String(m.run_date)))errors.push(`${manifestRel}:bad_run_date:${m.run_date}`);
 if(m.vertical&&!allowedVerticals.has(String(m.vertical).toLowerCase()))errors.push(`${manifestRel}:unsupported_vertical:${m.vertical}`);
 if(m.status&&!allowedStatuses.has(String(m.status)))errors.push(`${manifestRel}:bad_status:${m.status}`);
 const isQuarantined = m.status === 'QUARANTINED';
 if(isQuarantined) quarantinedCount += 1; else activeManifestCount += 1;
 if(isQuarantined && !m.quarantine_reason) errors.push(`${manifestRel}:quarantined_missing_reason`);
 if(isQuarantined && !m.quarantine_action) errors.push(`${manifestRel}:quarantined_missing_action`);
 for(const k of ['csv_path','html_path']){if(m[k]){const p=path.join(ROOT,m[k]);if(!fs.existsSync(p))errors.push(`${manifestRel}:missing_${k}:${m[k]}`);}}
 if(m.json_path){const jp=path.join(ROOT,m.json_path);if(!fs.existsSync(jp))errors.push(`${manifestRel}:missing_json_path:${m.json_path}`);else{try{const payload=readJson(jp); if(!payload || typeof payload !== 'object') errors.push(`${manifestRel}:json_artifact_not_object:${m.json_path}`);}catch(e){errors.push(`${manifestRel}:invalid_json_artifact:${e.message}`);}}}
 if(m.html_path&&!String(m.html_path).toLowerCase().endsWith('.html'))errors.push(`${manifestRel}:html_path_must_end_html:${m.html_path}`);
 if(m.json_path&&!String(m.json_path).toLowerCase().endsWith('.json'))errors.push(`${manifestRel}:json_path_must_end_json:${m.json_path}`);
 for(const k of ['csv_path','html_path','json_path']){if(!isQuarantined&&m[k]&&isUnresolvedLocalFetch(path.join(ROOT,m[k])))errors.push(`${manifestRel}:unresolved_local_fetch_artifact:${m[k]}`);}
 if(!isQuarantined&&m.csv_path&&fs.existsSync(path.join(ROOT,m.csv_path))){const headers=parseHeader(path.join(ROOT,m.csv_path));const requiredAny=[['Query','query','Target Query','Question'],['Patch Needed (Y/N)','Gap Found','Action Tier','Fix Recommendation']];for(const choices of requiredAny){if(!choices.some(h=>headers.includes(h)))errors.push(`${manifestRel}:csv_missing_any:${choices.join('|')}`);}}
}
if(!manifests.length)warnings.push('no_agent_run_manifests_present; social/backlog fallback may still release content');
const report={schema_version:'1.1',validator:'agent-run-artifact-intake',status:errors.length?'FAIL':'PASS',manifest_count:manifests.length,active_manifest_count:activeManifestCount,quarantined_manifest_count:quarantinedCount,manifests:manifests.map(rel),errors,warnings,checked_at:process.env.SOURCE_DATE||new Date().toISOString().slice(0,10)};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/agent-run-artifact-intake.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error('AGENT RUN ARTIFACT INTAKE FAIL');errors.forEach(e=>console.error(`- ${e}`));process.exit(1);}console.log(`AGENT RUN ARTIFACT INTAKE PASS: ${manifests.length} manifest(s).`);
