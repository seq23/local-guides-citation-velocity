'use strict';
const fs=require('fs'),path=require('path'); const {normalizeSeoExecution}=require('../lib/seo_execution_contract');
const ROOT=path.resolve(__dirname,'../..'); const base=path.join(ROOT,'data/report_fixes/agent_runs'); let files=[];
function walk(d){ if(!fs.existsSync(d))return; for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name); if(e.isDirectory())walk(p); else if(e.name.endsWith('.json')&&e.name!=='agent_run_manifest.json')files.push(p);}}
walk(base); const errors=[]; let checked=0; for(const f of files){let j; try{j=JSON.parse(fs.readFileSync(f,'utf8'));}catch{continue;} for(const r of (j.seo_execution||[])){checked++; const n=normalizeSeoExecution(r); const fatal=n.errors.filter(e=>e!=='self_link'); if(fatal.length) errors.push(`${path.relative(ROOT,f)}:${r.query||'unknown'}:${fatal.join(',')}`);}}
if(errors.length){console.error(errors.join('\n'));process.exit(1);} console.log(`seo-execution-contract: PASS (${checked} records)`);
