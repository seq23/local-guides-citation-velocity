#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'..');
const BAD_DOMAINS=[['hormoesivhair','com'].join('.'),['hormoesivehair','com'].join('.')];const SKIP_DIRS=new Set(['.git','node_modules','logs','artifacts']);
function scan(dir){let violations=[];for(const file of fs.readdirSync(dir)){const full=path.join(dir,file);const rel=path.relative(ROOT,full).replace(/\\/g,'/');const stat=fs.statSync(full);if(stat.isDirectory()){if(SKIP_DIRS.has(file))continue;violations=violations.concat(scan(full));}else{if(rel==='scripts/validate_canonical_domains.js')continue;let content;try{content=fs.readFileSync(full,'utf8');}catch{continue;}for(const domain of BAD_DOMAINS)if(content.includes(domain))violations.push({file:rel,domain});}}return violations;}
const violations=scan(ROOT);
// Brand separation (12 Oct 2026): no Spry Labs / West Peek name or domain in dist/
// or Pages Function source, and the lead sender pinned in code. See scripts/lib/brand_separation.js.
const brand=require('./lib/brand_separation').checkBrandSeparation({root:ROOT});
for(const f of brand.failures)violations.push({file:f,domain:'brand-separation'});
const report={validator:'canonical-domains',status:violations.length?'FAIL':'PASS',ok:violations.length===0,checked_domains:BAD_DOMAINS,brand_separation:{dist_files:brand.distFiles,function_files:brand.functionFiles,sending_files:brand.sendingFiles,workflow_files:brand.workflowFiles,failures:brand.failures},violations};fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/canonical-domains.json'),JSON.stringify(report,null,2)+'\n');if(violations.length){console.error('BAD CANONICAL DOMAIN FOUND');for(const r of violations)console.error(`${r.domain} in ${r.file}`);process.exit(1);}console.log(`Canonical domains clean; brand separation: ${brand.distFiles} dist files + ${brand.functionFiles} function files clean, lead sender pinned; ${brand.sendingFiles} sending files + ${brand.workflowFiles} workflows carry no West Peek or Spry sender`);
