#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const DATE=process.env.SOURCE_DATE||new Date().toISOString().slice(0,10);
const read=(rel,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));}catch{return fallback;}};
const write=(rel,v)=>{const abs=path.join(ROOT,rel);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,JSON.stringify(v,null,2)+'\n');};
const queue=read('data/release/page_release_queue.json',{records:[]});
const allowed=new Set((queue.records||[]).filter((r)=>r.eligible&&r.decision==='SAFE_AUTOPUBLISH'&&r.lifecycle_state==='ADMITTED_FOR_BUILD').map((r)=>r.target_route));
const staged=read('content/_staged/pages.json',{pages:[]});
const live=read('content/_live/pages.json',{pages:[]});
const liveMap=new Map((live.pages||[]).map((p)=>[p.slug||p.path,p]));
const promoted=[];
for(const page of staged.pages||[]){
 const route=page.slug||page.path;
 if(!allowed.has(route))continue;
 if(liveMap.has(route))continue;
 const promotedPage={...page,publication_status:'ADMITTED',date_modified:page.date_modified||DATE};
 live.pages.push(promotedPage);liveMap.set(route,promotedPage);promoted.push(route);
}
write('content/_live/pages.json',live);
write('artifacts/validation/staged-content-promotion.json',{schema_version:'1.0',status:'PASS',promoted_count:promoted.length,promoted_routes:promoted,promotion_policy:'only Safe Harbor ADMITTED_FOR_BUILD routes; existing live routes are never overwritten by this command'});
console.log(`STAGED CONTENT PROMOTION PASS: promoted=${promoted.length}`);
