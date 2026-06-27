#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT=path.resolve(__dirname,'../..');
const DATE=process.env.SOURCE_DATE||new Date().toISOString().slice(0,10);
function rel(p){return path.join(ROOT,p)}
function readJson(p,f=null){try{return JSON.parse(fs.readFileSync(rel(p),'utf8'))}catch{return f}}
function writeJson(p,v){const out=rel(p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n')}
function normalize(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function slugFromPath(p){return String(p||'').replace(/^insights\//,'').replace(/\.html$/,'')}
function pagePath(route){return String(route||'').replace(/^\//,'').replace(/\/$/,'/index.html')}
const plan=readJson('artifacts/validation/agent-exact-implementation-plan.json',{specs:[]});
const apply=readJson('artifacts/validation/agent-exact-implementation-apply.json',{results:[]});
const insights=readJson('content/_live/insights.json',{items:[]});
const livePages=readJson('content/_live/pages.json',{pages:[]});
const bySlug=new Map((insights.items||[]).map(item=>[item.slug,item]));
const pageSlugs=new Set((livePages.pages||[]).map(p=>p.slug||p.path));
const appliedByPath=new Map((apply.results||[]).map(r=>[r.implementation_path,r]));
const traces=[];const errors=[];
for(const spec of plan.specs||[]){
  if(spec.status==='BLOCKED'){
    const ok=Boolean(spec.blocked_reason);
    traces.push({...spec, trace_status:ok?'PASS':'FAIL'});
    if(!ok) errors.push(`${spec.record_id}:blocked row missing blocked_reason`);
    continue;
  }
  if(spec.operation==='REPAIR_INTENDED_WINNER_PAGE'){
    const item=bySlug.get(slugFromPath(spec.implementation_path));
    const applied=appliedByPath.get(spec.implementation_path);
    const text=JSON.stringify(item||{}).toLowerCase();
    const query=normalize((spec.queries||[spec.query])[0]);
    const hasQuery=query && text.includes(query.split(' ').slice(0,5).join(' '));
    const hasMarker=Boolean(item&&item.agent_exact_repair&&item.agent_exact_repair.last_repaired_at);
    const pass=Boolean(item&&applied&&applied.status==='APPLIED'&&hasMarker&&hasQuery);
    traces.push({...spec, trace_status:pass?'PASS':'FAIL', item_exists:Boolean(item), applied_status:applied?.status||'', has_agent_exact_repair:hasMarker, query_marker_found:hasQuery});
    if(!pass) errors.push(`${spec.record_id}:repair_not_proven:${spec.implementation_path}`);
  } else if(spec.operation==='CREATE_NEW_TARGET_PAGE'){
    const exists=pageSlugs.has(spec.target_route) || fs.existsSync(rel(pagePath(spec.target_route)));
    traces.push({...spec, trace_status:exists?'PASS':'FAIL', rendered_path:pagePath(spec.target_route), page_exists:exists});
    if(!exists) errors.push(`${spec.record_id}:new_page_not_proven:${spec.target_route}`);
  }
}
const report={schema_version:'1.0', status:errors.length?'FAIL':'PASS', checked_at:DATE, plan_count:(plan.specs||[]).length, traces, errors};
writeJson('artifacts/validation/agent-exact-implementation-trace.json', report);
if(errors.length){console.error('AGENT EXACT IMPLEMENTATION TRACE FAIL'); errors.forEach(e=>console.error(`- ${e}`)); process.exit(1)}
console.log(`AGENT EXACT IMPLEMENTATION TRACE PASS: ${traces.length} spec(s)`);
