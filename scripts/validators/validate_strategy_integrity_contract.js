#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const p=(rel)=>path.join(ROOT,rel);
const exists=(rel)=>fs.existsSync(p(rel));
const read=(rel)=>fs.readFileSync(p(rel),'utf8');
const json=(rel)=>JSON.parse(read(rel));
const errors=[],warnings=[];
const required=[
  'REPO_IDENTITY.md','AGENTS.md','data/strategy/citation_dominance_contract.json','data/strategy/citation_dominance_gap_registry.json',
  'data/providers/provider_substrate_contract.json','data/providers/provider_registry.json',
  'data/authority/reviewer_registry.json','data/authority/verified_same_as_registry.json',
  'data/network/network_identity_registry.json','data/evidence/source_registry.json'
];
for(const rel of required)if(!exists(rel))errors.push(`missing:${rel}`);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
const agents=read('AGENTS.md'), identityDoc=read('REPO_IDENTITY.md');
for(const stale of ['Velocity is not a publisher','LKG is the only repo allowed to publish','Velocity → LKG promotion boundary']){
  if(agents.includes(stale))errors.push(`stale_authority_doctrine:${stale}`);
}
if(!agents.includes('This repository is the publishing authority for `theindustryguides.com`'))errors.push('missing_velocity_only_publishing_boundary');
if(!identityDoc.includes('Velocity owns and publishes all guides'))errors.push('repo_identity_missing_velocity_publish_authority');
const strategy=json('data/strategy/citation_dominance_contract.json');
const layerIds=new Set((strategy.layers||[]).map(x=>x.id));
for(const id of ['substrate','reference_pages','authority','distribution'])if(!layerIds.has(id))errors.push(`strategy_layer_missing:${id}`);
if(strategy.operating_model?.publisher!=='The Industry Guides Editorial Team')errors.push('strategy_publisher_mismatch');
const sourceIds=new Set((json('data/evidence/source_registry.json').sources||[]).map(x=>x.source_id));
const providerContract=json('data/providers/provider_substrate_contract.json');
const providerRegistry=json('data/providers/provider_registry.json');
const reviewerRegistry=json('data/authority/reviewer_registry.json');
const sameAsRegistry=json('data/authority/verified_same_as_registry.json');
const network=json('data/network/network_identity_registry.json');
function requireFields(record,fields,prefix){for(const field of fields||[])if(record[field]===undefined||record[field]===null||record[field]===''||(Array.isArray(record[field])&&!record[field].length))errors.push(`${prefix}:missing:${field}`);}
const providerStatuses=new Set(providerContract.allowed_statuses||[]);
let verifiedProviders=0;
for(const [i,r] of (providerRegistry.records||[]).entries()){
  const pre=`provider:${i}:${r.provider_id||'unknown'}`;
  if(!providerStatuses.has(r.status))errors.push(`${pre}:invalid_status:${r.status}`);
  if(r.status==='VERIFIED'){
    verifiedProviders++;
    requireFields(r,providerContract.required_for_verified,pre);
    if(!providerContract.verticals.includes(r.vertical))errors.push(`${pre}:invalid_vertical:${r.vertical}`);
    if(r.source_id&&!sourceIds.has(r.source_id))errors.push(`${pre}:unknown_source_id:${r.source_id}`);
    for(const f of ['source_url','correction_process_url'])if(r[f]&&!/^https:\/\//.test(r[f]))errors.push(`${pre}:${f}_not_https`);
  }
}
const reviewerStatuses=new Set(reviewerRegistry.allowed_statuses||[]);
let verifiedReviewers=0;
const reviewerNames=new Set();
for(const [i,r] of (reviewerRegistry.reviewers||[]).entries()){
  const pre=`reviewer:${i}:${r.reviewer_id||'unknown'}`;
  if(!reviewerStatuses.has(r.status))errors.push(`${pre}:invalid_status:${r.status}`);
  if(r.status==='VERIFIED'){
    verifiedReviewers++;
    requireFields(r,reviewerRegistry.required_for_verified,pre);
    reviewerNames.add(r.name);
    for(const f of ['credential_source_url','profile_url'])if(r[f]&&!/^https:\/\//.test(r[f]))errors.push(`${pre}:${f}_not_https`);
  }
}
const sameAsStatuses=new Set(sameAsRegistry.allowed_statuses||[]);
const verifiedSameAs=new Set();
for(const [i,r] of (sameAsRegistry.records||[]).entries()){
  const pre=`sameAs:${i}:${r.entity_id||'unknown'}`;
  if(!sameAsStatuses.has(r.status))errors.push(`${pre}:invalid_status:${r.status}`);
  if(r.status==='VERIFIED'){
    requireFields(r,sameAsRegistry.required_for_verified,pre);
    if(r.url&&!/^https:\/\//.test(r.url))errors.push(`${pre}:url_not_https`);
    verifiedSameAs.add(r.url);
  }
}
function collectSameAs(v,out=[]){if(Array.isArray(v)){v.forEach(x=>collectSameAs(x,out));return out;}if(!v||typeof v!=='object')return out;for(const [k,x] of Object.entries(v)){if(k==='sameAs'){(Array.isArray(x)?x:[x]).forEach(u=>typeof u==='string'&&out.push(u));}else collectSameAs(x,out);}return out;}
for(const url of collectSameAs({organization:network.organization,website:network.website}))if(!verifiedSameAs.has(url))errors.push(`network_sameAs_not_verified:${url}`);
const htmlFiles=[];
function walk(abs){if(!fs.existsSync(abs))return;for(const ent of fs.readdirSync(abs,{withFileTypes:true})){if(['node_modules','.git','dist','reports','artifacts'].includes(ent.name))continue;const f=path.join(abs,ent.name);if(ent.isDirectory())walk(f);else if(f.endsWith('.html'))htmlFiles.push(f);}}
walk(ROOT);
let personAuthorCount=0, providerSchemaCount=0, publicProviderPageCount=0;
function visit(value){if(Array.isArray(value)){value.forEach(visit);return;}if(!value||typeof value!=='object')return;const type=value['@type'];const types=Array.isArray(type)?type:[type];if(types.includes('Person')&&(value.name||value.url)){personAuthorCount++;if(!reviewerNames.has(value.name))errors.push(`unregistered_person_schema:${value.name||value.url}`);}if(types.some(t=>['MedicalBusiness','LegalService','LocalBusiness','Dentist','Physician'].includes(t)))providerSchemaCount++;Object.values(value).forEach(visit);}
for(const file of htmlFiles){
  const rel=path.relative(ROOT,file).replace(/\\/g,'/');
  if(rel.startsWith('providers/'))publicProviderPageCount++;
  const html=fs.readFileSync(file,'utf8');
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{visit(JSON.parse(m[1]));}catch{}
  }
}
if(verifiedProviders===0&&(publicProviderPageCount||providerSchemaCount))errors.push(`provider_publication_without_verified_records:pages=${publicProviderPageCount}:schema=${providerSchemaCount}`);
const admission=json('data/content/page_admission_registry.json');
let admittedBylinesChecked=0;
function fileForRoute(route){if(route==='/')return p('index.html');if(route.endsWith('.html'))return p(route.replace(/^\//,''));return p(route.replace(/^\//,'').replace(/\/$/,'')+'/index.html');}
for(const page of admission.pages||[]){
  const file=fileForRoute(page.path);
  if(!fs.existsSync(file)){errors.push(`admitted_render_missing:${page.path}`);continue;}
  admittedBylinesChecked++;
  const html=fs.readFileSync(file,'utf8');
  if(!/data-editorial-byline=["']true["']/.test(html))errors.push(`admitted_page_missing_visible_editorial_byline:${page.path}`);
  const canonicalTag=(html.match(/<link\b[^>]*rel=(["'])canonical\1[^>]*>/i)||html.match(/<link\b[^>]*href=(["'])[^"']+\1[^>]*rel=(["'])canonical\2[^>]*>/i)||[])[0]||'';
  const canonicalHref=(canonicalTag.match(/\bhref=(["'])(.*?)\1/i)||[])[2]||'';
  if(canonicalHref.startsWith('https://theindustryguides.com/')){
    if(!/data-review-date=["']true["']/.test(html))errors.push(`self_canonical_page_missing_visible_review_date:${page.path}`);
    if(!/"dateModified"\s*:/.test(html))errors.push(`self_canonical_page_missing_dateModified:${page.path}`);
  }
}
const gaps=json('data/strategy/citation_dominance_gap_registry.json').items||[];
const gapById=new Map(gaps.map(x=>[x.id,x]));
if(verifiedProviders===0&&!String(gapById.get('SUBSTRATE-PROVIDERS')?.status||'').includes('EXTERNAL_DATA_REQUIRED'))errors.push('provider_gap_not_declared');
if(verifiedReviewers===0&&!String(gapById.get('AUTH-REVIEWERS')?.status||'').includes('VERIFIED_HUMAN_REQUIRED'))errors.push('reviewer_gap_not_declared');
for(const placeholder of ['Sarah'+' Chen JD','Sarah'+' Chen, JD']){
  for(const rel of ['scripts','docs','data','REPO_IDENTITY.md','AGENTS.md']){
    const abs=p(rel);if(!fs.existsSync(abs))continue;
    const st=fs.statSync(abs);const files=[];if(st.isFile())files.push(abs);else{const gather=(d)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())gather(f);else files.push(f);}};gather(abs);}for(const f of files)if(fs.readFileSync(f,'utf8').includes(placeholder))errors.push(`fabricated_placeholder_present:${path.relative(ROOT,f)}:${placeholder}`);
  }
}
const report={validator:'strategy-integrity-contract',ok:!errors.length,publisher_authority:'VELOCITY_ONLY',verified_provider_records:verifiedProviders,verified_reviewer_records:verifiedReviewers,verified_same_as_records:verifiedSameAs.size,person_schema_records:personAuthorCount,provider_schema_records:providerSchemaCount,public_provider_pages:publicProviderPageCount,admitted_bylines_checked:admittedBylinesChecked,errors,warnings,policy:{hard_fail:['contradictory repo authority','unregistered or unverified provider/reviewer/sameAs publication','fabricated authority placeholders','missing four-layer contract infrastructure'],non_blocking:['empty verified provider registry','empty verified reviewer registry','external press/backlinks/measurement gaps']}};
fs.mkdirSync(p('artifacts/validation'),{recursive:true});
fs.writeFileSync(p('artifacts/validation/strategy-integrity-contract.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.slice(0,100).join('\n'));process.exit(1);}
console.log(`Strategy integrity contract PASS: ${verifiedProviders} verified providers, ${verifiedReviewers} verified reviewers, ${verifiedSameAs.size} verified sameAs URLs; empty registries are truthful and non-blocking.`);
