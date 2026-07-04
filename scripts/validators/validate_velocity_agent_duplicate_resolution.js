#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'../..');
function rel(p){return path.join(ROOT,p)} function readJson(p,f=null){try{return JSON.parse(fs.readFileSync(rel(p),'utf8'))}catch{return f}} function writeJson(p,v){const out=rel(p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n')}
function walk(dirRel,out=[]){const start=rel(dirRel); if(!fs.existsSync(start)) return out; for(const ent of fs.readdirSync(start,{withFileTypes:true})){const p=path.join(dirRel,ent.name).replace(/\\/g,'/'); if(ent.isDirectory()) walk(p,out); else if(p.endsWith('.json')&&!p.endsWith('/latest.json')) out.push(p)} return out}
const ledgers=walk('data/report_fixes/source_record_ledgers').map(p=>readJson(p,{records:[],dedupe_groups:[]}));
const groups=new Map();
for(const l of ledgers){ for(const r of l.records||[]){ const key=r.canonical_key||`${r.recommendation_type}|${r.vertical}|${r.query}|${r.repo_file_path||r.target_url}`; if(!groups.has(key)) groups.set(key,{canonical_key:key, source_record_ids:[], targets:new Set(), statuses:new Set()}); const g=groups.get(key); g.source_record_ids.push(r.source_record_id); if(r.repo_file_path||r.target_url) g.targets.add(r.repo_file_path||r.target_url); g.statuses.add(r.status||'DISCOVERED'); } }
const duplicate_groups=[...groups.values()].filter(g=>g.source_record_ids.length>1).map(g=>({canonical_key:g.canonical_key, canonical_target:[...g.targets][0]||'', source_record_ids:[...new Set(g.source_record_ids)], status:'DEDUPED_WITH_SOURCE_PROOF'}));
const errors=[];
for(const g of duplicate_groups){ if(!g.canonical_key) errors.push('duplicate_group_missing_canonical_key'); if(!g.source_record_ids.length) errors.push(`duplicate_group_missing_sources:${g.canonical_key}`); }
const report={schema_version:'1.0',validator:'velocity-agent-duplicate-resolution',status:errors.length?'FAIL':'PASS',source_record_count:[...groups.values()].reduce((n,g)=>n+g.source_record_ids.length,0),canonical_target_count:groups.size,deduped_record_count:duplicate_groups.reduce((n,g)=>n+Math.max(0,g.source_record_ids.length-1),0),duplicate_groups,errors};
writeJson('artifacts/validation/velocity-agent-duplicate-resolution.json', report);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`VELOCITY AGENT DUPLICATE RESOLUTION PASS: groups=${groups.size}; duplicates=${duplicate_groups.length}`);
