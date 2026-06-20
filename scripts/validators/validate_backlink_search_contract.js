#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const errors=[];
const backlinks=read('data/seo/backlink_evidence_registry.json');
const search=read('data/seo/search_submission_registry.json');
const manifest=read('artifacts/release/SEARCH_SUBMISSION_MANIFEST.json');
const disavowPath=path.join(ROOT,backlinks.operative_file||'seo/disavow/theindustryguides.com-disavow.txt');
if(backlinks.domain!=='theindustryguides.com')errors.push('backlink_scope_not_velocity');
if((backlinks.confirmed_harmful_domains||[]).length!==7)errors.push(`backlink_domain_count:${(backlinks.confirmed_harmful_domains||[]).length}`);
if(!fs.existsSync(disavowPath))errors.push('missing_velocity_disavow');
const text=fs.existsSync(disavowPath)?fs.readFileSync(disavowPath,'utf8'):'';
for(const domain of backlinks.confirmed_harmful_domains||[])if(!text.includes(`domain:${domain}`))errors.push(`missing_disavow_domain:${domain}`);
if(search.scope!=='VELOCITY_ONLY')errors.push('search_scope_not_velocity');
if((search.domains||[]).length!==1||search.domains[0]?.domain!=='theindustryguides.com')errors.push('search_domain_count');
if(search.domains[0]?.gsc_status!=='MANUAL_OWNER_ACTION'||search.domains[0]?.bing_status!=='MANUAL_OWNER_ACTION')errors.push('manual_submission_contract');
if(!manifest.priority_url_count||manifest.priority_url_count<200)errors.push(`priority_url_count:${manifest.priority_url_count}`);
const report={validator:'backlink-search-contract',ok:!errors.length,scope:'VELOCITY_ONLY',harmful_domains:(backlinks.confirmed_harmful_domains||[]).length,search_domains:(search.domains||[]).length,priority_urls:manifest.priority_url_count,errors,checked_at:'2026-06-19'};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/backlink-search-contract.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log('Velocity backlink evidence and manual search-submission package PASS.');
