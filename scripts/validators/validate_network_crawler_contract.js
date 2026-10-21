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
// EDGE CACHE (Ahrefs 14 Oct 2026: 41 slow pages, 9 slow responses to AI crawlers;
// every HTML page answered cf-cache-status: DYNAMIC). Two halves, both checked here:
//  1. _headers gives every served URL exactly ONE Cache-Control, carrying s-maxage>0.
//     Pages joins the values of every rule a URL matches, and 1,300 extensionless
//     pages (/insights/x, /about, root comparisons, /atlas/) matched none and went out
//     as max-age=0, must-revalidate - uncacheable whatever the zone does.
//  2. config/cloudflare/zone_cache_rules.json (applied by
//     scripts/cloudflare/apply_zone_cache_rules.js) makes the zone cache them, with
//     TTL from origin, and keeps /api/ (Pages Functions) dynamic.
let edgeChecked=0;
{
  const st=require('../lib/served_tree');
  const rules=[];let cur=null;
  for(const line of fs.readFileSync(path.join(ROOT,'_headers'),'utf8').split('\n')){
    if(!line.trim()||line.trim().startsWith('#'))continue;
    if(!/^\s/.test(line)){cur={pattern:line.trim(),headers:[]};rules.push(cur);continue;}
    const m=line.trim().match(/^([A-Za-z-]+):\s*(.*)$/);if(cur&&m)cur.headers.push([m[1].toLowerCase(),m[2]]);
  }
  const toRe=(pattern)=>new RegExp('^'+pattern.split(/(\*|:[A-Za-z]\w*)/).map((part)=>part==='*'?'.*':part.startsWith(':')?'[^/]+':part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('')+'$');
  const compiled=rules.map((r)=>({...r,re:toRe(r.pattern)}));
  const cacheControlFor=(url)=>compiled.filter((r)=>r.re.test(url)).flatMap((r)=>r.headers.filter(([k])=>k==='cache-control').map(([,v])=>`${r.pattern} => ${v}`));
  const uncached=[],doubled=[];
  for(const abs of st.servedHtmlFiles(ROOT)){
    const rel=path.relative(ROOT,abs).replace(/\\/g,'/');if(rel==='404.html')continue;
    const route=st.routeForHtmlRel(rel);const url=route.endsWith('.html')?route.slice(0,-5):route;
    edgeChecked++;
    const cc=cacheControlFor(url);
    if(cc.length>1)doubled.push(`${url} (${cc.join(' | ')})`);
    else if(!cc.length||!/s-maxage=[1-9]/.test(cc[0])||/no-store|private/.test(cc[0]))uncached.push(`${url}${cc.length?` (${cc[0]})`:' (no Cache-Control rule)'}`);
  }
  if(!edgeChecked)errors.push('edge_cache: zero served pages examined');
  for(const u of uncached.slice(0,20))errors.push(`edge_cache_not_cacheable:${u}`);
  if(uncached.length>20)errors.push(`edge_cache_not_cacheable: ... ${uncached.length-20} more`);
  for(const u of doubled.slice(0,20))errors.push(`edge_cache_cache_control_joined:${u}`);
  if(cacheControlFor('/assets/site.css').length!==1)errors.push('edge_cache: /assets/* must get exactly one Cache-Control');
  let zone=null;try{zone=read('config/cloudflare/zone_cache_rules.json');}catch{errors.push('edge_cache: config/cloudflare/zone_cache_rules.json missing - nothing makes HTML cache-eligible at the zone');}
  if(zone){
    const rule=(zone.rules||[]).find((r)=>r.action==='set_cache_settings'&&r.enabled!==false);
    if(zone.zone!=='theindustryguides.com'||!rule)errors.push('edge_cache: zone_cache_rules.json has no enabled set_cache_settings rule for theindustryguides.com');
    else{
      if(!rule.action_parameters||rule.action_parameters.cache!==true)errors.push('edge_cache: zone cache rule does not set cache: true');
      if(!/not starts_with\(http\.request\.uri\.path, "\/api\/"\)/.test(rule.expression))errors.push('edge_cache: zone cache rule does not exclude /api/ - lead capture and click tracking must stay dynamic');
      if(!/http\.host eq "theindustryguides\.com"/.test(rule.expression))errors.push('edge_cache: zone cache rule is not scoped to the theindustryguides.com host');
      if(((rule.action_parameters||{}).edge_ttl||{}).mode!=='respect_origin')errors.push('edge_cache: edge TTL must come from origin Cache-Control (_headers decides freshness)');
    }
  }
}
if(errors.length){console.error(errors.slice(0,60).join('\n'));process.exit(1);}
console.log(`Network identity and search-crawler contract passed for ${checked} rendered routes; edge cache: ${edgeChecked} served page(s) each get one edge-cacheable Cache-Control and the zone cache rule keeps /api/ dynamic; ${verifiedSameAs.size} verified sameAs URL(s).`);
