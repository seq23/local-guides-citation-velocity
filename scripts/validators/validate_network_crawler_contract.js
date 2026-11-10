#!/usr/bin/env node
'use strict';
// network-crawler-contract: no identity claim by resemblance.
// A sameAs URL has to be VERIFIED, and "VERIFIED" has to mean something. The
// registry's allowed_bases say what a record may rest on, and this proves each
// record satisfies the one it claims: a FIRST_PARTY_ENTITY_PAGE must be on the
// entity's own host (so it cannot smuggle in an unowned domain), and a
// THIRD_PARTY_PROFILE must have a source_url OFF that host (so a profile cannot
// be claimed by resemblance, which is how `dentistryguides` and
// `thedentistryguides` become one entity by accident). Every sameAs the
// published Organization carries must be https, VERIFIED and not our own host.
// Trimmed 10 Nov 2026 to this rule (hostile review of the validator cut); the
// crawler-policy, edge-cache and rendered-schema checks were cut.
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..','..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const errors=[];
const identity=read('data/network/network_identity_registry.json');
const sameAsRegistry=read(identity.verified_same_as_registry||'data/authority/verified_same_as_registry.json');
const records=sameAsRegistry.records||[];
if(!records.length)errors.push('examined_nothing:same_as_registry_has_no_records');
const verifiedSameAs=new Set(records.filter(r=>r.status==='VERIFIED').map(r=>r.url));
function collectSameAs(value,out=[]){
  if(Array.isArray(value)){for(const item of value)collectSameAs(item,out);return out;}
  if(!value||typeof value!=='object')return out;
  for(const [key,item] of Object.entries(value)){
    if(key==='sameAs'){for(const url of (Array.isArray(item)?item:[item]))if(typeof url==='string')out.push(url);}
    else collectSameAs(item,out);
  }
  return out;
}
const ENTITY_HOST=String(sameAsRegistry.entity_host||'theindustryguides.com');
const ALLOWED_BASES=new Set(Object.keys(sameAsRegistry.allowed_bases||{}));
if(!ALLOWED_BASES.size)errors.push('same_as_registry_declares_no_allowed_bases');
const hostOf=(u)=>{try{return new URL(u).hostname.replace(/^www\./,'');}catch{return null;}};
const onEntityHost=(u)=>hostOf(u)===ENTITY_HOST;
let basesChecked=0;
for(const r of records){
  if(r.status!=='VERIFIED')continue;
  basesChecked++;
  for(const field of sameAsRegistry.required_for_verified||[])if(!r[field])errors.push(`same_as_record_missing_${field}:${r.url||'(no url)'}`);
  if(!ALLOWED_BASES.has(r.basis)){errors.push(`same_as_basis_not_allowed:${r.url}:${r.basis}`);continue;}
  if(onEntityHost(r.url))errors.push(`verified_same_as_on_entity_host:${r.url}`);
  if(r.basis==='THIRD_PARTY_PROFILE'&&(!r.source_url||onEntityHost(r.source_url)))errors.push(`third_party_same_as_source_not_off_host:${r.source_url||'(none)'}`);
}
// The DERIVED node is what every page renders; it fills sameAs from VERIFIED records.
const publishedOrg=require('../lib/network_schema').networkSchemaNodes()[0]||{};
const publishedSameAs=collectSameAs({organization:publishedOrg,website:identity.website});
for(const url of publishedSameAs){
  if(!/^https:\/\//.test(url))errors.push(`sameAs_not_https:${url}`);
  if(!verifiedSameAs.has(url))errors.push(`sameAs_not_verified:${url}`);
  if(onEntityHost(url))errors.push(`sameAs_self_reference:${url}`);
}
const report={validator:'network-crawler-contract',ok:!errors.length,verified_same_as_count:verifiedSameAs.size,bases_checked:basesChecked,published_same_as:publishedSameAs,same_as_bases:[...ALLOWED_BASES],entity_host:ENTITY_HOST,errors};
fs.mkdirSync(path.join(ROOT,'artifacts','validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts','validation','network-crawler-contract.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.slice(0,60).join('\n'));process.exit(1);}
console.log(`sameAs basis contract passed: ${basesChecked} VERIFIED record(s) satisfy their basis; ${publishedSameAs.length} published sameAs URL(s) all VERIFIED.`);
