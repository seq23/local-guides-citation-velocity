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
 return (plan.specs||[]).filter((spec)=>spec.operation==='REPAIR_INTENDED_WINNER_PAGE'&&spec.status==='PLANNED');
}
function repairRoute(spec){return implementationPathToRoute(spec.target_route||spec.implementation_path||'');}
// A ROUTE COMPLETING A FREEZE TRANSACTION IS NOT EVIDENCE THE RECOMMENDATION LANDED.
//
// This marked every record attached to an accepted route RELEASED_VERIFIED on route
// acceptance alone. "Accepted" means the route was thawed, rebuilt and refrozen. It
// says nothing about whether the edit the agent asked for is on the page.
//
// 2026-09-02: a TRT run landed 51 recommendations, all against trt/index.html. The
// route was thawed for an unrelated repair spec and refrozen, so all 51 were recorded
// RELEASED_VERIFIED. Twelve of their required_markers were not on the page and still
// are not - among them the comparison matrix for "TRT injections vs gel". The mark is
// not cosmetic: prepare_velocity_intake_release.js excludes RELEASED_VERIFIED ids from
// selection permanently, so those twelve recommendations could never be worked again.
// The fix ledger reported delivery, the disposition ledger reported
// QUEUED_FOR_FUTURE_RELEASE, and nothing compared either to the page.
//
// Every fix already declares required_markers: the text that must be on the rendered
// page for the recommendation to be satisfied. That declaration is the test. A fix
// whose markers are absent is recorded ACCEPTED_ROUTE_MARKERS_ABSENT - honest, visible,
// and still selectable, so a later release can actually work it.
function markersPresent(fix){
 const rendered=fix.renderedPath||'';
 if(!rendered)return false;
 const abs=path.join(ROOT,rendered);
 if(!fs.existsSync(abs))return false;
 const markers=Array.isArray(fix.required_markers)?fix.required_markers.filter(Boolean):[];
 // No declared marker means there is nothing to verify against. That is unproven, not
 // proven: a fix that cannot say what it would change is the "runs but inert" shape
 // this check exists to stop, and defaulting it to true would reopen the whole hole.
 if(!markers.length)return false;
 const html=fs.readFileSync(abs,'utf8');
 const decoded=html.replace(/&#8212;/g,'—').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/&amp;/g,'&');
 return markers.every((marker)=>{
   const raw=String(marker);
   const encoded=raw.replace(/—/g,'&#8212;');
   return html.includes(raw)||decoded.includes(raw)||html.includes(encoded)||decoded.includes(encoded);
 });
}
function markCompletedAgentRepairs(acceptedRoutes){
 const accepted=new Set((acceptedRoutes||[]).map(implementationPathToRoute));
 const ids=new Set();
 for(const spec of currentRepairSpecs()){
   const route=repairRoute(spec);
   if(!accepted.has(route))continue;
   for(const id of [...(spec.record_ids||[spec.record_id])].filter(Boolean))ids.add(id);
 }
 const ledger=readJson('data/report_fixes/agent_fix_ledger.json',{fixes:[]});
 let changed=0;let unproven=0;const unprovenIds=new Set();
 for(const fix of ledger.fixes||[]){
   if(!ids.has(fix.id))continue;
   fix.after_hash=fileHash(fix.renderedPath||'');
   fix.marker_checked_at=DATE;
   if(!markersPresent(fix)){
     fix.implementation_status='ACCEPTED_ROUTE_MARKERS_ABSENT';
     fix.marker_verification='required_markers_not_found_on_rendered_page';
     unprovenIds.add(fix.id);unproven++;
     continue;
   }
   fix.implementation_status='RELEASED_VERIFIED';fix.completed_at=DATE;
   fix.marker_verification='required_markers_present_on_rendered_page';
   changed++;
 }
 if(unproven)console.warn(`AGENT REPAIR COMPLETION: ${unproven} record(s) on accepted routes were NOT marked released - their required_markers are absent from the rendered page. They stay selectable so a later release can work them.`);
 ledger.updated_at=DATE;writeJson('data/report_fixes/agent_fix_ledger.json',ledger);
 const dispositions=readJson('data/report_fixes/agent_artifact_disposition_ledger.json',{entries:[]});
 for(const entry of dispositions.entries||[]){
   if(!ids.has(entry.id))continue;
   if(unprovenIds.has(entry.id)){
     // Do not clear selected_for_release here. The recommendation was not delivered,
     // so it has to remain visible to the next selection pass rather than being
     // retired into the same silence the released rows go to.
     entry.disposition='ACCEPTED_ROUTE_MARKERS_ABSENT';entry.completed_at=null;
     continue;
   }
   entry.disposition='RELEASED_VERIFIED';entry.selected_for_release=false;entry.completed_at=DATE;
 }
 dispositions.updated_at=DATE;writeJson('data/report_fixes/agent_artifact_disposition_ledger.json',dispositions);
 return {record_ids_marked:changed,record_ids_unproven:unproven};
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
   // The sitemap is derived from data/content/page_admission_registry.json
   // (scripts/build_site.js:203), and that registry is only rebuilt HERE - four
   // steps after the build that reads it. So a route this release admitted could
   // never appear in the sitemap this release publishes, and
   // validate_page_release_law correctly reported it as sitemap_missing. On
   // 2026-08-30 that took Velocity Content Release red on the first two rich
   // pages the daily ceiling ever let through:
   //   /dentistry/guides/dental-bridge-vs-implant-which-is-better/:sitemap_missing
   //   /dentistry/guides/how-do-i-find-a-good-dentist-for-my-child/:sitemap_missing
   //
   // The registry cannot simply move earlier: isRendered() in the registry
   // builder tests for built index.html on disk, so it has to run after a build.
   // Re-derive instead, from the registry that now exists. restoreFrozenPages()
   // still runs after this, so frozen page HTML is unaffected; the sitemap is not
   // a frozen page and is exactly what needs to advance.
   run('npm run build');
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
