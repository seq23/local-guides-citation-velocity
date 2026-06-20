#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'data','seo','backlink_evidence_registry.json'),'utf8'));
const outputs=[];
for(const entry of registry.domains||[]){
  const out=path.join(ROOT,entry.proposed_disavow_path);
  fs.mkdirSync(path.dirname(out),{recursive:true});
  const domains=[...new Set((entry.confirmed_harmful_domains||[]).map(v=>String(v).trim().toLowerCase()).filter(Boolean))].sort();
  const lines=[`# Proposed disavow file for ${entry.domain}`,`# Generated from data/seo/backlink_evidence_registry.json on ${registry.effective_date}.`,`# Only evidence-classified CONFIRMED_HARMFUL domains are emitted.`,'',...domains.map(d=>`domain:${d}`)];
  fs.writeFileSync(out,lines.join('\n')+'\n','utf8');
  outputs.push({domain:entry.domain,path:entry.proposed_disavow_path,confirmed_harmful_count:domains.length,status:domains.length?'READY_FOR_HUMAN_REVIEW':'BLOCKED_BACKLINK_EXPORT_REQUIRED'});
}
const report={generated_at:new Date().toISOString(),outputs};
fs.mkdirSync(path.join(ROOT,'artifacts','validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts','validation','disavow-generation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
