#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process');const ROOT=path.resolve(__dirname,'..');
const manifestPath=path.join(ROOT,'_artifact_validation_manifest.json'),releaseDir=path.join(ROOT,'artifacts/release');
const reports=[
 {id:'validation-profile-release',path:'artifacts/validation/validation-summary-release.json',profile:'release'},
 {id:'validation-profile-advisory',path:'artifacts/validation/validation-summary-advisory.json',profile:'advisory'},
 {id:'monitor-ledger',path:'artifacts/validation/monitor-ledger.json',requireStatus:true},
 {id:'programmatic-substance',path:'artifacts/validation/programmatic-substance.json',requireStatus:true},
 {id:'workflow-data-trace',path:'artifacts/validation/workflow-data-trace.json',requireStatus:true},
 {id:'browser-contract',path:'artifacts/validation/browser-contract.json',requireOk:true},
 {id:'ui-test-parity',path:'artifacts/validation/ui-test-parity.json',requireStatus:true},
 {id:'deterministic-build',path:'artifacts/validation/determinism.json',requireOk:true},
 {id:'repository-hygiene',path:'artifacts/validation/repo-hygiene.json',requireOk:true}
];
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');const failures=[],evidence=[],profiles={};
if(!fs.existsSync(manifestPath)){console.error('_artifact_validation_manifest.json is missing');process.exit(1);}const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
for(const entry of reports){const abs=path.join(ROOT,entry.path);if(!fs.existsSync(abs)){failures.push(`${entry.id}:missing`);continue;}let d;try{d=JSON.parse(fs.readFileSync(abs,'utf8'));}catch{failures.push(`${entry.id}:invalid-json`);continue;}
 if(entry.profile){const selected=Number(d.validator_ids?.length??d.selected_count??d.selected??0);const failed=Number(d.counts?.FAIL??d.fail_count??d.failed??0);const blocked=Number(d.counts?.PREPARE_FAILED??0)+Number(d.counts?.PREREQUISITE_MISSING??0)+Number(d.counts?.TIMEOUT??0);if(String(d.status).toUpperCase()!=='PASS'||!Number.isFinite(selected)||selected<1||failed!==0||blocked!==0)failures.push(`${entry.id}:profile-not-clean`);profiles[entry.profile]={selected,failed,blocked};}
 if(entry.requireOk&&d.ok!==true)failures.push(`${entry.id}:ok=${d.ok}`);if(entry.requireStatus&&String(d.status).toUpperCase()!=='PASS')failures.push(`${entry.id}:status=${d.status}`);evidence.push({id:entry.id,path:entry.path,sha256:sha(abs)});
}
if(failures.length){console.error(`validation attestation refused: ${failures.join(', ')}`);process.exit(1);}let commit=String(process.env.GITHUB_SHA||'').trim();if(!commit){try{commit=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();}catch{commit='UNVERSIONED_ARTIFACT';}}
const att={schema_version:'5.0',status:'VALIDATED_ARTIFACT_READY',artifact_scope:'VELOCITY_ONLY',commit_sha:commit,created_at:`${process.env.SOURCE_DATE||'2026-06-19'}T00:00:00.000Z`,source_manifest_sha256:sha(manifestPath),validation_reports:evidence,validation_profiles:profiles,monitor_counts_dynamic:true,historical_monitor_fixture:'2026-06-19',deterministic_build_required:true,repository_hygiene_required:true,self_healing_content_required:true,workflow_data_trace_required:true,browser_contract_required:true,release_critical_files:manifest.release_critical_files,distribution_must_consume_this_artifact:true,external_proof_deferred:['deployed-playwright','local-node-24-updater']};fs.mkdirSync(releaseDir,{recursive:true});fs.writeFileSync(path.join(releaseDir,'validation-attestation.json'),JSON.stringify(att,null,2)+'\n');console.log(`VALIDATION ATTESTATION CREATED (${evidence.length} reports, commit ${commit})`);
