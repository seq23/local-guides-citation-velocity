#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'); const ROOT=path.resolve(__dirname,'..','..');
const m=JSON.parse(fs.readFileSync(path.join(ROOT,'data','canonical_candidates','full_scope_2026_06_19','manifest.json'),'utf8')); const errors=[];
const expected={'USCIS-STATE-CIVIL-SURGEON':50,'USCIS-SUPPORT':10,'PI-STATE-SOL':50,'PI-STATE-NEGLIGENCE':50,'DENTISTRY-STATE-INSURANCE':50,'DENTISTRY-STATE-MEDICAID':50,'DENTISTRY-COST-HUBS':2,'NEURO-STATE-FINDER':50,'TRT-STATE-LEGALITY':50,'TRT-STATE-TELEHEALTH':50};
if(m.count!==412)errors.push(`count:${m.count}`);
for(const [k,v] of Object.entries(expected))if(m.counts_by_family?.[k]!==v)errors.push(`${k}:${m.counts_by_family?.[k]}!=${v}`);
const ids=new Set(),routes=new Set(); for(const c of m.candidates||[]){if(ids.has(c.candidate_id))errors.push(`duplicate_id:${c.candidate_id}`);ids.add(c.candidate_id);const key=`${c.canonical_domain}${c.route}`;if(routes.has(key))errors.push(`duplicate_route:${key}`);routes.add(key);if(c.implementation_status!=='BLOCKED_CANONICAL_REPO_SOURCE_ZIP_NOT_SUPPLIED')errors.push(`untruthful_status:${key}`);if(!c.source_ids?.length||!c.required_fields?.length)errors.push(`incomplete_candidate:${key}`);}
const report={validator:'canonical-candidate-package',ok:!errors.length,count:m.count,errors};fs.mkdirSync(path.join(ROOT,'artifacts','validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts','validation','canonical-candidate-package.json'),JSON.stringify(report,null,2)+'\n');if(errors.length){console.error(errors.slice(0,50).join('\n'));process.exit(1)}console.log('Canonical candidate package passed: 412 unique external-repo implementation specs.');
