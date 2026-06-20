#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=(p)=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const write=(p,v)=>{const out=path.join(ROOT,p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n');};
const admission=read('data/content/page_admission_registry.json');
const insights=read('content/_live/insights.json');
const wins=read('data/citation_velocity/wins.json');
const registry=read('data/routing/canonical_destination_registry.json');
const domainByVertical={personal_injury:'https://theaccidentguides.com/','personal-injury':'https://theaccidentguides.com/',dentistry:'https://dentistryguides.com/',trt:'https://hormonesivhair.com/',neuro:'https://neuroevalguides.com/','uscis-medical':'https://uscisexam.com/'};
const insightByPath=new Map((insights.items||[]).map(i=>[i.publish_path,i]));
const existingSpecific=new Map((registry.page_routes||[]).map(r=>[r.route,r]));
const pageRoutes=[];
for(const page of admission.pages||[]){
  const domain=domainByVertical[page.vertical];
  if(!domain) continue;
  const insight=insightByPath.get(page.path);
  const specific=existingSpecific.get(page.path);
  const canonical=(specific&&specific.canonical_url)||(insight&&insight.canonical_target_url)||domain;
  pageRoutes.push({route:page.path,vertical:page.vertical,canonical_url:canonical,destination_type:(insight?'canonical_guide':'canonical_home_or_registered_guide'),placements:['above_fold','contextual_body','decision_artifact','end_module'],last_verified:'2026-06-19',status:'ACTIVE'});
}
registry.page_routes=pageRoutes.sort((a,b)=>a.route.localeCompare(b.route));
registry.count=registry.page_routes.length;
write('data/routing/canonical_destination_registry.json',registry);

const winRoutes=new Set();
for(const w of wins.wins||[]){ if(w.page) winRoutes.add(w.page); if(w.route) winRoutes.add(w.route); if(w.url){ try{winRoutes.add(new URL(w.url).pathname);}catch{}} }
const dispositions=(admission.pages||[]).map(p=>({route:p.path,vertical:p.vertical,disposition:winRoutes.has(p.path)||((p.win_ids||[]).length)?'PRESERVE_MONITOR_WIN':'KEEP_AND_UPGRADE',basis:winRoutes.has(p.path)||((p.win_ids||[]).length)?'Recorded Citation Velocity win regression fixture':'Admitted route retained and governed by the full-scope evidence, atom, routing, and freshness contracts',source_owner:p.source_owner,status:'APPLIED'}));
write('data/overhaul/page_disposition_registry.json',{schema_version:'1.1',effective_date:'2026-06-19',baseline_existing_count:1131,new_velocity_count:632,total_records:dispositions.length,dispositions});
console.log(JSON.stringify({routing_records:pageRoutes.length,dispositions:dispositions.length},null,2));
