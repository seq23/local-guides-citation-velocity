#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..','..');
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'data','seo','search_submission_registry.json'),'utf8'));
const published=JSON.parse(fs.readFileSync(path.join(ROOT,'content','_live','published_urls.json'),'utf8'));
const urls=(published.urls||published.items||published).map(v=>typeof v==='string'?v:(v.url||v.loc)).filter(Boolean);
const priority=urls.filter(u=>/theindustryguides\.com\/(personal-injury|dentistry|neuro|trt|uscis-medical|insights|[^/]+-vs-)/.test(u)).slice(0,500);
const generatedAt=`${registry.effective_date}T00:00:00.000Z`;
const payload={schema_version:'1.0',generated_at:generatedAt,source_url_count:urls.length,priority_url_count:priority.length,domains:registry.domains,priority_urls:priority,hash:crypto.createHash('sha256').update(priority.join('\n')).digest('hex')};
fs.mkdirSync(path.join(ROOT,'artifacts','release'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts','release','SEARCH_SUBMISSION_MANIFEST.json'),JSON.stringify(payload,null,2)+'\n');
fs.writeFileSync(path.join(ROOT,'artifacts','release','GSC_BING_RESUBMISSION_RUNBOOK.md'),`# GSC + Bing Resubmission Runbook\n\nGenerated: ${payload.generated_at}\n\n1. Verify each domain property and current deployment.\n2. Submit the sitemap URL recorded in data/seo/search_submission_registry.json.\n3. Submit the reviewed disavow file only when confirmed harmful domains are present.\n4. Submit changed Velocity URLs through the existing IndexNow package where supported.\n5. Record submission IDs, dates, and hashes back into the registry.\n\nCredentialed submission remains an external owner action.\n`);
console.log(JSON.stringify({source_url_count:urls.length,priority_url_count:priority.length,hash:payload.hash},null,2));
