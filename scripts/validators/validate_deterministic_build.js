#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'../..');
function inferSourceDate(){
 const explicit=String(process.env.SOURCE_DATE||process.env.RELEASE_DATE||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(explicit))return explicit;
 const dates=[];const add=v=>{const d=String(v||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(d))dates.push(d);};
 try{const html=fs.readFileSync(path.join(ROOT,'index.html'),'utf8');for(const m of html.matchAll(/(?:dateModified[^0-9]*|datetime=["'])(\d{4}-\d{2}-\d{2})/g))add(m[1]);}catch{}
 try{const state=JSON.parse(fs.readFileSync(path.join(ROOT,'content/_shared/content_state.json'),'utf8'));for(const entry of Object.values(state))add(entry&&entry.lastmod);}catch{}
 try{const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'data/content/page_admission_registry.json'),'utf8'));for(const entry of registry.pages||registry.routes||[])add(entry&&(entry.date_modified||entry.last_modified||entry.reviewed_at||entry.admitted_at));}catch{}
 if(!dates.length)throw new Error('SOURCE_DATE_REQUIRED:no_baseline_or_durable_date');return dates.sort().at(-1);
}
const SOURCE_DATE=inferSourceDate();
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'velocity-determinism-'));
const rebuilt=path.join(tmp,'rebuilt');
const excludes=new Set(['.git','node_modules','.build','dist','reports','artifacts']);
function copy(dst){fs.cpSync(ROOT,dst,{recursive:true,filter:(src)=>{const rel=path.relative(ROOT,src);if(!rel)return true;return !rel.split(path.sep).some(x=>excludes.has(x));}});}
function run(dir){const r=cp.spawnSync(process.execPath,['scripts/build_site.js'],{cwd:dir,env:{...process.env,ALLOW_CANONICAL_DATA_REGEN:'1',SOURCE_DATE},encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw new Error(`build failed in ${dir}:\n${r.stdout}\n${r.stderr}`);}
function hashFile(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function fingerprint(dir){const roots=['index.html','sitemap.xml','feed.xml','feed.json','llms.txt','robots.txt','personal-injury','trt','dentistry','neuro','uscis-medical','insights','atlas','medium','sitemaps'];const out={};function walk(abs){if(!fs.existsSync(abs))return;const st=fs.statSync(abs);if(st.isFile()){out[path.relative(dir,abs)]=hashFile(abs);return;}for(const name of fs.readdirSync(abs).sort())walk(path.join(abs,name));}for(const rel of roots)walk(path.join(dir,rel));return out;}
let report;
try{
  const baseline=fingerprint(ROOT);
  copy(rebuilt);
  run(rebuilt);
  const candidate=fingerprint(rebuilt);
  const keys=[...new Set([...Object.keys(baseline),...Object.keys(candidate)])].sort();
  const differences=keys.filter(k=>baseline[k]!==candidate[k]);
  report={validator:'deterministic-build',ok:!differences.length,comparison:'current-render-vs-clean-rebuild',file_count_baseline:Object.keys(baseline).length,file_count_rebuilt:Object.keys(candidate).length,differences,checked_at:SOURCE_DATE};
  if(differences.length)throw new Error(`determinism mismatch: ${differences.slice(0,20).join(', ')}`);
}catch(e){report={validator:'deterministic-build',ok:false,comparison:'current-render-vs-clean-rebuild',error:e.message,checked_at:SOURCE_DATE};}
finally{fs.rmSync(tmp,{recursive:true,force:true});}
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/determinism.json'),JSON.stringify(report,null,2)+'\n');
if(!report.ok){console.error(report.error||report.differences);process.exit(1);}
console.log(`DETERMINISM PASS (${report.file_count_rebuilt} files; one clean rebuild)`);
