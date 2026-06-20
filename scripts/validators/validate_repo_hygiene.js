#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=process.cwd();
const violations=[];
const ignoredDirs=new Set(['.git','node_modules','.build','dist','reports','coverage','logs']);
const ignoredPrefixes=['artifacts/validation/runtime/'];
const forbiddenNames=[/^local-guides-citation-velocity_BACKUP\.zip$/i,/^.*_BACKUP\.zip$/i,/^patch_bundle$/i,/^fix_files$/i,/^artifact_output$/i];
function rel(p){return path.relative(ROOT,p).replace(/\\/g,'/');}
function ignored(r){return ignoredPrefixes.some(prefix=>r===prefix.slice(0,-1)||r.startsWith(prefix));}
function checkDir(dir){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name); const r=rel(p);
    if(ignored(r)) continue;
    if(ent.isDirectory()){
      if(ignoredDirs.has(ent.name)) continue;
      if(forbiddenNames.some(rx=>rx.test(ent.name))) violations.push({type:'forbidden_directory',path:r});
      if(ent.name==='local-guides-citation-velocity'||ent.name.endsWith('_LOCAL_BACKUP')){
        const hasPkg=fs.existsSync(path.join(p,'package.json')); const hasScripts=fs.existsSync(path.join(p,'scripts'));
        if(hasPkg||hasScripts) violations.push({type:'nested_repo_copy',path:r});
      }
      checkDir(p);
    }else if(ent.isFile()){
      if(forbiddenNames.some(rx=>rx.test(ent.name))) violations.push({type:'forbidden_file',path:r});
      if(/\.log$/i.test(ent.name)) violations.push({type:'log_file_outside_runtime',path:r});
      if(/\.zip$/i.test(ent.name)) violations.push({type:'nested_zip',path:r});
    }
  }
}
checkDir(ROOT);
const contract=JSON.parse(fs.readFileSync(path.join(ROOT,'_baseline_packaging_contract.json'),'utf8'));
const excluded=new Set(contract.excluded||[]);
for(const required of ['.git','node_modules','dist','reports','.build','logs','artifacts/validation/runtime','*.log','*.zip']) if(!excluded.has(required)) violations.push({type:'packaging_exclusion_missing',path:required});
const ignoreText=fs.readFileSync(path.join(ROOT,'.gitignore'),'utf8');
for(const required of ['.build/','dist/','reports/','logs/','artifacts/validation/runtime/','*.log','*.zip']) if(!ignoreText.split(/\r?\n/).includes(required)) violations.push({type:'gitignore_missing',path:required});
const report={validator:'repo-hygiene',ok:violations.length===0,generated_runtime_directories_allowed_when_excluded:true,violations};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/repo-hygiene.json'),JSON.stringify(report,null,2)+'\n');
if(violations.length){console.error('Repo hygiene failed. See artifacts/validation/repo-hygiene.json');console.error(JSON.stringify(violations.slice(0,20),null,2));process.exit(1);}
console.log('REPO HYGIENE PASS');
