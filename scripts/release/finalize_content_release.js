#!/usr/bin/env node
'use strict';
const cp=require('child_process'),fs=require('fs'),path=require('path');
const {beginMutationScope,acceptMutationScope,rollbackMutationScope,consumePendingMutationRoutes,freezeNewAdmitted,restoreFrozenPages,implementationPathToRoute,loadRegistry}=require('../lib/frozen_pages');
const ROOT=path.resolve(__dirname,'../..');
const DATE=process.env.SOURCE_DATE||new Date().toISOString().slice(0,10);
const backupDir=path.join(ROOT,'.build','release-source-backup');
const livePages=path.join(ROOT,'content/_live/pages.json');
const BACKUP_FILES=['content/_live/pages.json','content/_staged/pages.json','content/_live/insights.json','data/evidence/source_registry.json','data/evidence/state_source_registry.json','data/page_families/velocity_page_specs.json'];
function readJson(relPath,fallback={}){try{return JSON.parse(fs.readFileSync(path.join(ROOT,relPath),'utf8'));}catch{return fallback;}}
function writeJson(relPath,value){const out=path.join(ROOT,relPath);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(value,null,2)+'\n');}
function fileHash(relPath){const p=path.join(ROOT,relPath);if(!fs.existsSync(p))return null;return require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
function currentRepairSpecs(){
 const plan=readJson('data/report_fixes/agent_exact_implementation_plan.json',{specs:[]});
 return (plan.specs||[]).filter((spec)=>spec.operation==='REPAIR_INTENDED_WINNER_PAGE'&&spec.status!=='BLOCKED');
}
function repairRoute(spec){return implementationPathToRoute(spec.target_route||spec.implementation_path||'');}
function markCompletedAgentRepairs(acceptedRoutes){
 const accepted=new Set((acceptedRoutes||[]).map(implementationPathToRoute));
 const ids=new Set();
 for(const spec of currentRepairSpecs()){
   const route=repairRoute(spec);
   if(!accepted.has(route))continue;
   for(const id of [...(spec.record_ids||[spec.record_id])].filter(Boolean))ids.add(id);
 }
 const ledger=readJson('data/report_fixes/agent_fix_ledger.json',{fixes:[]});
 let changed=0;
 for(const fix of ledger.fixes||[]){if(!ids.has(fix.id))continue;fix.implementation_status='RELEASED_VERIFIED';fix.completed_at=DATE;fix.after_hash=fileHash(fix.renderedPath||'');changed++;}
 ledger.updated_at=DATE;writeJson('data/report_fixes/agent_fix_ledger.json',ledger);
 const dispositions=readJson('data/report_fixes/agent_artifact_disposition_ledger.json',{entries:[]});
 for(const entry of dispositions.entries||[]){if(ids.has(entry.id)){entry.disposition='RELEASED_VERIFIED';entry.selected_for_release=false;entry.completed_at=DATE;}}
 dispositions.updated_at=DATE;writeJson('data/report_fixes/agent_artifact_disposition_ledger.json',dispositions);
 return {record_ids_marked:changed};
}

function run(command){console.log(`\n$ ${command}`);const r=cp.spawnSync(command,{cwd:ROOT,shell:true,stdio:'inherit',env:{...process.env,SOURCE_DATE:DATE,NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=3072'}});if(r.status!==0)throw new Error(`command_failed:${command}:${r.status}`);}
function backup(){fs.rmSync(backupDir,{recursive:true,force:true});for(const relPath of BACKUP_FILES){const src=path.join(ROOT,relPath);if(!fs.existsSync(src))continue;const dst=path.join(backupDir,relPath);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}}
function rollbackSource(){for(const relPath of BACKUP_FILES){const src=path.join(backupDir,relPath);if(!fs.existsSync(src))continue;const dst=path.join(ROOT,relPath);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}}
function main(){
 const pending=consumePendingMutationRoutes();
 const releaseId=`content-${DATE}-${process.pid}`;
 const repairSpecs=currentRepairSpecs();
 const expectedRepairRoutes=[...new Set(repairSpecs.map(repairRoute).filter(Boolean))];
 const frozenRoutes=new Set((loadRegistry().pages||[]).map((p)=>implementationPathToRoute(p.route)));
 const expectedExistingRepairRoutes=expectedRepairRoutes.filter((route)=>frozenRoutes.has(route));
 backup();
 const scope=beginMutationScope(pending,releaseId);
 const thawed=new Set(scope.thawed_routes||[]);
 const missed=expectedExistingRepairRoutes.filter((route)=>!thawed.has(route));
 if(missed.length){
   rollbackMutationScope();
   throw new Error(`exact_repair_routes_not_thawed:${missed.join(',')}`);
 }
 try{
   run('node scripts/release/promote_staged_content.js');
   run('node scripts/content/run_source_self_heal_loop.js');
   run('npm run build');
   run('node scripts/content/validate_rendered_programmatic_substance.js');
   run('node scripts/validators/validate_rich_new_page_contract.js');
   run('node scripts/validators/validate_page_family_contract.js');
   run('node scripts/build_page_admission_registry_2026_06_19.js');
   const frozenNew=freezeNewAdmitted();
   const accepted=acceptMutationScope();
   const acceptedSet=new Set(accepted.routes||[]);
   const notAccepted=expectedExistingRepairRoutes.filter((route)=>!acceptedSet.has(route));
   if(notAccepted.length)throw new Error(`exact_repair_routes_not_refrozen:${notAccepted.join(',')}`);
   restoreFrozenPages();
   run('node scripts/validators/validate_page_release_law.js');
   run('node scripts/build_pages_dist.js');
   const completedAgentRepairs=markCompletedAgentRepairs(accepted.routes||[]);
   fs.rmSync(backupDir,{recursive:true,force:true});
   console.log(JSON.stringify({status:'PASS',release_id:releaseId,refrozen_existing:accepted.accepted,frozen_new:frozenNew.added_count,completed_agent_repairs:completedAgentRepairs},null,2));
 }catch(err){
   console.error(err.stack||err.message);
   rollbackSource();
   rollbackMutationScope();
   restoreFrozenPages();
   console.error('CONTENT RELEASE ROLLED BACK TO PRIOR LIVE SOURCE + FROZEN ACCEPTED OUTPUT');
   process.exit(1);
 }
}
main();
