#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const violations = [];
const ignoredDirs = new Set(['.git','node_modules']);
const forbiddenNames = [
  /^local-guides-citation-velocity_BACKUP\.zip$/i,
  /^.*_BACKUP\.zip$/i,
  /^patch_bundle$/i,
  /^fix_files$/i,
  /^artifact_output$/i
];
const generatedDirs = [
  '.build','coverage','reports','data/backlog','data/intake/source_ingestion',
  'data/answer_surface','data/answer_surface_monitoring','dist'
];
function rel(p){ return path.relative(ROOT,p).replace(/\\/g,'/'); }
function isIgnoredDir(name){ return ignoredDirs.has(name); }
function checkDir(dir){
  for (const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p = path.join(dir, ent.name);
    const r = rel(p);
    if (ent.isDirectory()){
      if (isIgnoredDir(ent.name)) continue;
      if (forbiddenNames.some(rx=>rx.test(ent.name))) violations.push({type:'forbidden_directory', path:r});
      if (ent.name === 'local-guides-citation-velocity' || ent.name.endsWith('_LOCAL_BACKUP')) {
        const hasPkg = fs.existsSync(path.join(p,'package.json'));
        const hasScripts = fs.existsSync(path.join(p,'scripts'));
        if (hasPkg || hasScripts) violations.push({type:'nested_repo_copy', path:r});
      }
      checkDir(p);
    } else if (ent.isFile()){
      if (forbiddenNames.some(rx=>rx.test(ent.name))) violations.push({type:'forbidden_file', path:r});
      if (/\.log$/i.test(ent.name)) violations.push({type:'log_file_tracked_candidate', path:r});
    }
  }
}
checkDir(ROOT);
for (const d of generatedDirs) {
  if (fs.existsSync(path.join(ROOT,d))) violations.push({type:'generated_artifact_present', path:d, note:'Must be ignored/untracked unless explicitly required for runtime.'});
}
fs.mkdirSync('reports',{recursive:true});
fs.writeFileSync('reports/repo_hygiene_report.json', JSON.stringify({generated_at:new Date().toISOString(), violations},null,2)+'\n');
if (violations.length) {
  console.error('Repo hygiene failed. See reports/repo_hygiene_report.json');
  console.error(JSON.stringify(violations.slice(0,20),null,2));
  process.exit(1);
}
console.log('Repo hygiene OK');
