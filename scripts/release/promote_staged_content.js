#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const DATE=process.env.SOURCE_DATE||new Date().toISOString().slice(0,10);
const read=(rel,fallback)=>{try{return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));}catch{return fallback;}};
const write=(rel,v)=>{const abs=path.join(ROOT,rel);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,JSON.stringify(v,null,2)+'\n');};
const queue=read('data/release/page_release_queue.json',{records:[]});
/*
 * ALREADY_STAGED IS THE STATE THAT NEEDS PROMOTING - it was excluded, and that closed a circle.
 *
 * This accepted only ADMITTED_FOR_BUILD. velocity_content_release.js, meanwhile, SKIPS any route
 * already present in content/_staged/pages.json, because there is nothing to create. So a staged,
 * unbuilt route was refused by both halves: the creator would not create it (it exists) and the
 * promoter would not promote it (wrong state). It sat staged for ever while every run reported PASS.
 *
 * On 2026-09-11 that was 32 routes, and the promoter printed "promoted=0" as a PASS - runs but
 * inert, wearing a green line. They were only reachable at all because the release lane kept
 * re-admitting them, which is what made the release artifact contradict itself and took CI red.
 *
 * A route in ALREADY_STAGED is admitted work whose page has been staged and not yet promoted.
 * Promoting it is the whole job. Both states are eligible and SAFE_AUTOPUBLISH; neither is a
 * loosening of who may publish, and the liveMap guard below still means an existing live route is
 * never overwritten.
 */
const PROMOTABLE_STATES = new Set(['ADMITTED_FOR_BUILD', 'ALREADY_STAGED']);
const allowed=new Set((queue.records||[]).filter((r)=>r.eligible&&r.decision==='SAFE_AUTOPUBLISH'&&PROMOTABLE_STATES.has(r.lifecycle_state)).map((r)=>r.target_route));
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
