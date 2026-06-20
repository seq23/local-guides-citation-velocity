#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');const {spawn}=require('child_process');
const ROOT=path.resolve(__dirname,'../..');
const args=process.argv.slice(2);const mode=(args.includes('--mode')?args[args.indexOf('--mode')+1]:'validate');const resume=args.includes('--resume');
if(!['validate','self-heal'].includes(mode)){console.error(`UNKNOWN_RELEASE_MODE:${mode}`);process.exit(2);}
const SOURCE_DATE=process.env.SOURCE_DATE||readReleaseDate();
const NODE_OPTIONS=process.env.NODE_OPTIONS||'--max-old-space-size=3072';
const CHECKPOINT=path.join(ROOT,'artifacts/validation/release-pipeline-checkpoint.json');
const REPORT=path.join(ROOT,'artifacts/validation/release-pipeline-report.json');
const LOG_ROOT=path.join(ROOT,'logs/release-pipeline');
const durableRoots=['.github/workflows','scripts','templates','content/_staged','content/_shared','data/citation_velocity','data/evidence','data/page_families','data/workflows','data/overhaul'];
const durableFiles=['package.json','package-lock.json','_validation_registry.json','_repo_validation_matrix.json','_browser_suite_contract.json','_public_route_manifest.json','REPO_IDENTITY.md','.nvmrc'];
function readReleaseDate(){
 const dates=[];const add=v=>{const d=String(v||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(d))dates.push(d);};
 try{const payload=JSON.parse(fs.readFileSync(path.join(ROOT,'data/citation_velocity/runs.json'),'utf8'));add(payload.current_through);for(const run of payload.runs||[])add(run.date||run.run_date);}catch{}
 try{const state=JSON.parse(fs.readFileSync(path.join(ROOT,'content/_shared/content_state.json'),'utf8'));for(const entry of Object.values(state))add(entry&&entry.lastmod);}catch{}
 try{const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'data/content/page_admission_registry.json'),'utf8'));for(const entry of registry.pages||registry.routes||[])add(entry&&(entry.date_modified||entry.last_modified||entry.reviewed_at||entry.admitted_at));}catch{}
 if(!dates.length)throw new Error('SOURCE_DATE_REQUIRED:no_durable_release_date');return dates.sort().at(-1);
}
function walk(p,out=[]){if(!fs.existsSync(p))return out;const st=fs.statSync(p);if(st.isFile()){out.push(p);return out;}for(const e of fs.readdirSync(p,{withFileTypes:true})){const q=path.join(p,e.name);if(e.isDirectory())walk(q,out);else out.push(q);}return out;}
function fingerprint(){const h=crypto.createHash('sha256');const files=[];for(const rel of durableRoots)files.push(...walk(path.join(ROOT,rel)));for(const rel of durableFiles){const p=path.join(ROOT,rel);if(fs.existsSync(p))files.push(p);}for(const p of [...new Set(files)].sort()){const rel=path.relative(ROOT,p).replace(/\\/g,'/');if(/(^|\/)(node_modules|artifacts|logs|dist|reports|\.build)(\/|$)/.test(rel))continue;h.update(rel+'\0');h.update(fs.readFileSync(p));h.update('\0');}return h.digest('hex');}
function safeRead(p){try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return null;}}
function save(obj,p=CHECKPOINT){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(obj,null,2)+'\n');}
function stage(name,command,timeoutMinutes=20){return {name,command,timeout_ms:timeoutMinutes*60*1000};}
const stages=[];
if(mode==='self-heal')stages.push(stage('monitor-metadata-reconcile','node scripts/citation_velocity/reconcile_monitor_ledger.js',2),stage('programmatic-source-self-heal-loop','node scripts/content/run_source_self_heal_loop.js',12));
stages.push(
 stage('monitor-ledger-validation','node scripts/validators/validate_monitor_ledger.js',3),
 stage('programmatic-source-quality','node scripts/content/validate_programmatic_substance.js',5),
 stage('site-build','npm run build',20),
 stage('programmatic-render-quality','node scripts/content/validate_rendered_programmatic_substance.js',8),
 stage('page-admission-registry','node scripts/build_page_admission_registry_2026_06_19.js',5),
 stage('route-and-disposition-registries','node scripts/build_full_scope_route_and_disposition_registries.js',5),
 stage('search-submission-manifest','node scripts/seo/build_search_submission_manifest.js',5),
 stage('validation-matrix-refresh','node scripts/validation/generate_validation_matrix.js',3),
 stage('release-validation','node scripts/validation/run_validation_registry.js --profile release',35),
 stage('advisory-validation','node scripts/validation/run_validation_registry.js --profile advisory --collect-all',10),
 stage('release-evidence','npm run release:reports',10),
 stage('artifact-manifest','node scripts/validators/build_artifact_validation_manifest.js',10),
 stage('artifact-attestation','node scripts/create_validation_attestation.js',10)
);
async function runStage(s,runDir){const log=path.join(runDir,`${String(stages.indexOf(s)+1).padStart(2,'0')}-${s.name}.log`);fs.mkdirSync(path.dirname(log),{recursive:true});const stream=fs.createWriteStream(log,{flags:'a'});stream.write(`$ ${s.command}\nNODE_OPTIONS=${NODE_OPTIONS}\nSOURCE_DATE=${SOURCE_DATE}\n\n`);return new Promise(resolve=>{const child=spawn(s.command,{cwd:ROOT,shell:true,env:{...process.env,NODE_OPTIONS,SOURCE_DATE},stdio:['ignore','pipe','pipe']});let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM');setTimeout(()=>child.kill('SIGKILL'),5000).unref();},s.timeout_ms);child.stdout.on('data',d=>{process.stdout.write(d);stream.write(d)});child.stderr.on('data',d=>{process.stderr.write(d);stream.write(d)});child.on('error',e=>{clearTimeout(timer);stream.write(`\nSPAWN_ERROR ${e.stack||e.message}\n`);stream.end();resolve({ok:false,code:null,signal:null,timed_out:false,error:e.message,log:path.relative(ROOT,log).replace(/\\/g,'/')});});child.on('close',(code,signal)=>{clearTimeout(timer);stream.write(`\nEXIT code=${code} signal=${signal||''} timed_out=${timedOut}\n`);stream.end();resolve({ok:code===0&&!timedOut,code,signal,timed_out:timedOut,log:path.relative(ROOT,log).replace(/\\/g,'/')});});});}
(async()=>{fs.mkdirSync(LOG_ROOT,{recursive:true});const initial=fingerprint();let checkpoint=resume?safeRead(CHECKPOINT):null;let completed=[];if(checkpoint&&checkpoint.mode===mode&&checkpoint.status!=='PASS'&&checkpoint.source_fingerprint===initial){completed=checkpoint.completed_stages||[];console.log(`RESUMING RELEASE PIPELINE after ${completed.length} completed stage(s).`);}else if(checkpoint&&resume){console.log('RELEASE PIPELINE CHECKPOINT INVALIDATED BY SOURCE CHANGE; restarting safely.');}
 const runId=`${SOURCE_DATE}-${mode}-${process.pid}`;const runDir=path.join(LOG_ROOT,runId);const results=[];let currentFingerprint=initial;save({schema_version:'1.0',mode,status:'RUNNING',source_date:SOURCE_DATE,source_fingerprint:currentFingerprint,completed_stages:completed,run_id:runId,updated_at:new Date().toISOString()});
 for(const s of stages){if(completed.includes(s.name)){console.log(`SKIP ${s.name} (checkpointed PASS)`);results.push({name:s.name,status:'CHECKPOINT_PASS'});continue;}console.log(`\n=== ${s.name} ===`);const started=Date.now();const r=await runStage(s,runDir);results.push({name:s.name,status:r.ok?'PASS':'FAIL',duration_ms:Date.now()-started,...r});if(!r.ok){const report={schema_version:'1.0',mode,status:'FAIL',failed_stage:s.name,source_date:SOURCE_DATE,source_fingerprint:fingerprint(),completed_stages:completed,results,run_id:runId,resume_command:`node scripts/release/run_staged_release.js --mode ${mode} --resume`};save(report,CHECKPOINT);save(report,REPORT);console.error(`RELEASE PIPELINE FAILED AT ${s.name}. Resume is safe after repair.`);process.exit(1);}completed.push(s.name);currentFingerprint=fingerprint();save({schema_version:'1.0',mode,status:'RUNNING',source_date:SOURCE_DATE,source_fingerprint:currentFingerprint,completed_stages:completed,results,run_id:runId,updated_at:new Date().toISOString()});}
 const report={schema_version:'1.0',mode,status:'PASS',source_date:SOURCE_DATE,source_fingerprint:fingerprint(),completed_stages:completed,results,run_id:runId,node_options:NODE_OPTIONS,advance_rule:'A stage runs only after the preceding stage passes. Source repair is bounded; validation failure stops the pipeline before render, release, or attestation.',resume_supported:true};save(report,CHECKPOINT);save(report,REPORT);console.log(`STAGED RELEASE PIPELINE PASS (${mode}, ${stages.length} stages)`);
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
