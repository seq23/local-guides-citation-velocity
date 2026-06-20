#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),cp=require('child_process');
const ROOT=path.resolve(__dirname,'../..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'velocity-determinism-'));
const rebuilt=path.join(tmp,'rebuilt');
const excludes=new Set(['.git','node_modules','.build','dist','reports','artifacts']);
function copy(dst){fs.cpSync(ROOT,dst,{recursive:true,filter:(src)=>{const rel=path.relative(ROOT,src);if(!rel)return true;return !rel.split(path.sep).some(x=>excludes.has(x));}});}
function run(dir){const r=cp.spawnSync(process.execPath,['scripts/build_site.js'],{cwd:dir,env:{...process.env,ALLOW_CANONICAL_DATA_REGEN:'1',SOURCE_DATE:'2026-06-19'},encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw new Error(`build failed in ${dir}:\n${r.stdout}\n${r.stderr}`);}
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
  report={validator:'deterministic-build',ok:!differences.length,comparison:'current-render-vs-clean-rebuild',file_count_baseline:Object.keys(baseline).length,file_count_rebuilt:Object.keys(candidate).length,differences,checked_at:'2026-06-19'};
  if(differences.length)throw new Error(`determinism mismatch: ${differences.slice(0,20).join(', ')}`);
}catch(e){report={validator:'deterministic-build',ok:false,comparison:'current-render-vs-clean-rebuild',error:e.message,checked_at:'2026-06-19'};}
finally{fs.rmSync(tmp,{recursive:true,force:true});}
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/determinism.json'),JSON.stringify(report,null,2)+'\n');
if(!report.ok){console.error(report.error||report.differences);process.exit(1);}
console.log(`DETERMINISM PASS (${report.file_count_rebuilt} files; one clean rebuild)`);
