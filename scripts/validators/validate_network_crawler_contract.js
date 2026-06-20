#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const errors=[],warnings=[];
const identity=read('data/network/network_identity_registry.json');
const policy=read('data/network/crawler_policy.json');
const sameAsRegistry=read(identity.verified_same_as_registry||'data/authority/verified_same_as_registry.json');
const robots=fs.readFileSync(path.join(ROOT,'robots.txt'),'utf8');
const admission=read('data/content/page_admission_registry.json');
const policyByAgent=new Map((policy.agents||[]).map(a=>[a.agent,a.directive]));
for(const agent of ['Googlebot','Bingbot','OAI-SearchBot']){
  if(policyByAgent.get(agent)!=='Allow')errors.push(`search_policy_not_allowed:${agent}`);
  if(!robots.includes(`User-agent: ${agent}`))errors.push(`robots_missing:${agent}`);
}
for(const agent of ['GPTBot','ChatGPT-User','ClaudeBot','PerplexityBot','Google-Extended']){
  const directive=policyByAgent.get(agent);
  if(!['Allow','Disallow'].includes(directive))errors.push(`crawler_choice_not_explicit:${agent}`);
  if(!robots.includes(`User-agent: ${agent}`))warnings.push(`robots_agent_not_explicit:${agent}`);
}
const verifiedSameAs=new Set((sameAsRegistry.records||[]).filter(r=>r.status==='VERIFIED').map(r=>r.url));
function collectSameAs(value,out=[]){
  if(Array.isArray(value)){for(const item of value)collectSameAs(item,out);return out;}
  if(!value||typeof value!=='object')return out;
  for(const [key,item] of Object.entries(value)){
    if(key==='sameAs'){
      const urls=Array.isArray(item)?item:[item];
      for(const url of urls)if(typeof url==='string')out.push(url);
    } else collectSameAs(item,out);
  }
  return out;
}
for(const url of collectSameAs({organization:identity.organization,website:identity.website})){
  if(!/^https:\/\//.test(url))errors.push(`sameAs_not_https:${url}`);
  if(!verifiedSameAs.has(url))errors.push(`sameAs_not_verified:${url}`);
}
function fileFor(route){if(route==='/')return path.join(ROOT,'index.html');if(route.endsWith('.html'))return path.join(ROOT,route.replace(/^\//,''));return path.join(ROOT,route.replace(/^\//,'').replace(/\/$/,''),'index.html');}
let checked=0;
for(const p of admission.pages||[]){
  const file=fileFor(p.path);
  if(!fs.existsSync(file)){errors.push(`missing_render:${p.path}`);continue;}
  checked++;
  const html=fs.readFileSync(file,'utf8');
  for(const id of ['https://theindustryguides.com/#organization','https://theindustryguides.com/#website'])if(!html.includes(id))errors.push(`rendered_schema_missing:${p.path}:${id}`);
}
const report={
  validator:'network-crawler-contract',ok:!errors.length,
  search_agents_required:['Googlebot','Bingbot','OAI-SearchBot'],
  explicit_choice_agents:['GPTBot','ChatGPT-User','ClaudeBot','PerplexityBot','Google-Extended'],
  same_as_policy:'Allowed only when present in data/authority/verified_same_as_registry.json with status VERIFIED.',
  verified_same_as_count:verifiedSameAs.size,routes_checked:checked,errors,warnings
};
fs.mkdirSync(path.join(ROOT,'artifacts','validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts','validation','network-crawler-contract.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.slice(0,60).join('\n'));process.exit(1);}
console.log(`Network identity and search-crawler contract passed for ${checked} rendered routes; ${verifiedSameAs.size} verified sameAs URL(s).`);
