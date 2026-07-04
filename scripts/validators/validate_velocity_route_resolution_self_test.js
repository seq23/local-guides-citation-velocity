#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'../..');
const {resolveTargetPath, normalizeSlugComparable, similarityScore}=require('../lib/citation_route_resolver');
function writeJson(p,v){const out=path.join(ROOT,p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n')}
function firstHtml(){ const dirs=['insights','guides','near-me','compare']; for(const d of dirs){const abs=path.join(ROOT,d); if(!fs.existsSync(abs)) continue; const f=fs.readdirSync(abs).find(x=>x.endsWith('.html')); if(f) return `${d}/${f}`;} return 'index.html'; }
const existing=firstHtml();
const typo=existing.replace(/[aeiou]/i,'');
const exact=resolveTargetPath(existing);
const fuzzy=resolveTargetPath({value:typo, query:typo.replace(/[-/]/g,' '), operation:'REPAIR_INTENDED_WINNER_PAGE'});
const newPage=resolveTargetPath({value:'brand-new-agent-page-that-should-not-collapse', query:'brand new agent page that should not collapse into existing pages', operation:'CREATE_NEW_TARGET_PAGE'});
const tests=[
 {name:'exact_existing_route', pass:!exact.block_reason && exact.implementation_path===existing, result:exact},
 {name:'misspelled_existing_route', pass:!fuzzy.block_reason && Boolean(fuzzy.implementation_path), result:fuzzy},
 {name:'new_page_guard_preserves_new_target', pass:!newPage.block_reason && /NEW_PAGE_TARGET_PRESERVED|EXACT_NEW_PAGE_DUPLICATE_EXISTS/.test(newPage.status), result:newPage},
 {name:'similarity_score_operational', pass:similarityScore('dentstry-guide','dentistry-guide')>=0.7, result:{score:similarityScore('dentstry-guide','dentistry-guide'), comparable:normalizeSlugComparable('Dentistry Guide')}}
];
const errors=tests.filter(t=>!t.pass).map(t=>`${t.name}:failed`);
const report={schema_version:'1.0',validator:'velocity-route-resolution-self-test',status:errors.length?'FAIL':'PASS',existing_fixture:existing,tests,errors};
writeJson('artifacts/validation/velocity-route-resolution-self-test.json',report);
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log(`VELOCITY ROUTE RESOLUTION SELF TEST PASS: ${tests.length} cases`);
