#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const errors=[],warnings=[];
const pages=read('data/page_families/velocity_page_specs.json').pages||[];
const sources=read('data/evidence/source_registry.json').sources||[];
const sourceMap=new Map(sources.map(s=>[s.source_id,s]));
const statePages=pages.filter(p=>p.state);
const liveEditorial=read('content/_live/pages.json').pages||[];
const stagedEditorial=read('content/_staged/pages.json').pages||[];
const automaticPages=liveEditorial.filter(p=>p.velocity_only_program==='AUTOMATIC_PUBLIC_SIGNAL_RELEASE');
const stagedAutomatic=new Map(stagedEditorial.filter(p=>p.velocity_only_program==='AUTOMATIC_PUBLIC_SIGNAL_RELEASE').map(p=>[p.slug,p]));
const answers=[];const patterns=new Map();const exact=new Map();
const automaticAnswers=[];const automaticPatterns=new Map();const automaticExact=new Map();
const stateNames=statePages.map(p=>p.state.name.toLowerCase()).sort((a,b)=>b.length-a.length);
function wc(s){return String(s||'').trim().split(/\s+/).filter(Boolean).length;}
function norm(s){let x=String(s||'').toLowerCase();for(const n of stateNames)x=x.replaceAll(n,'{state}');return x.replace(/\b[a-z]{2}\b/g,'{abbr}').replace(/\b20\d{2}-\d{2}-\d{2}\b/g,'{date}').replace(/\d+/g,'{n}').replace(/[^a-z{}]+/g,' ').replace(/\s+/g,' ').trim();}
function add(map,key,route){const arr=map.get(key)||[];arr.push(route);map.set(key,arr);}
for(const p of statePages){
 if(!p.state_authority?.authority_name||!p.state_authority?.authority_url||!p.state_authority?.selection_instruction)errors.push(`${p.slug}:missing_state_authority`);
 const directFamilies=new Set(['PI-STATE-SOL','PI-STATE-NEGLIGENCE','NEURO-STATE-FINDER','TRT-STATE-LEGALITY','TRT-STATE-TELEHEALTH']);
 if(directFamilies.has(p.page_family)&&p.state_authority?.direct_state_authority!==true)errors.push(`${p.slug}:direct_state_authority_required`);
 if(directFamilies.has(p.page_family)&&/(congress\.gov\/state-legislature-websites|asppb\.net|fsmb\.org\/contact-a-state-medical-board)/i.test(String(p.state_authority?.authority_url||'')))errors.push(`${p.slug}:directory_not_direct_authority`);
 if(['DENTISTRY-STATE-INSURANCE','DENTISTRY-STATE-MEDICAID'].includes(p.page_family)&&p.state_authority?.resolution_type!=='OFFICIAL_FEDERAL_STATE_SELECTOR')errors.push(`${p.slug}:official_state_selector_required`);
 if((p.source_records||[]).some(id=>id.startsWith('SRC-USA-STATE-')))errors.push(`${p.slug}:generic_usagov_source_forbidden`);
 if((p.source_records||[]).length<2)errors.push(`${p.slug}:insufficient_sources`);
 for(const id of p.source_records||[]){const s=sourceMap.get(id);if(!s)errors.push(`${p.slug}:missing_source:${id}`);else if(!/^https:\/\//.test(s.url||''))errors.push(`${p.slug}:non_https_source:${id}`);}
 if(!String(p.dated_primary_fact||'').includes(p.state.name)||!String(p.dated_primary_fact||'').match(/20\d{2}-\d{2}-\d{2}/))errors.push(`${p.slug}:dated_fact_not_state_specific`);
 const sectionCount=(p.sections||[]).length;if(sectionCount<3)errors.push(`${p.slug}:insufficient_decision_sections:${sectionCount}`);else if(sectionCount!==5)warnings.push(`${p.slug}:section_count_advisory:${sectionCount}`);
 let projected=wc([p.title,p.description,p.dated_primary_fact,...(p.sections||[]).flatMap(s=>[s.q,s.a,...(s.checklist||[]),...(s.red_flags||[])])].join(' '));
 if(projected<250)errors.push(`${p.slug}:unusably_thin_projected_words:${projected}`);else if(projected<650)warnings.push(`${p.slug}:projected_depth_advisory:${projected}`);
 if(!Number.isInteger(p.self_healing?.projected_word_count)||p.self_healing.projected_word_count<250)errors.push(`${p.slug}:self_healing_unusable_words:${p.self_healing?.projected_word_count}`);else if(p.self_healing.projected_word_count<650)warnings.push(`${p.slug}:self_healing_depth_advisory:${p.self_healing.projected_word_count}`);
 for(const [i,s] of (p.sections||[]).entries()){
  const words=wc(s.a);if(words<20||words>250)errors.push(`${p.slug}:section_${i+1}_unusable_length:${words}`);else if(words<45||words>110)warnings.push(`${p.slug}:section_${i+1}_length_advisory:${words}`);
  if(!String(s.a).includes(p.state.name))errors.push(`${p.slug}:faq_${i+1}_not_state_specific`);
  if(/start with the current governing source|use the primary federal or state source identified on this page|source registry was reviewed/i.test(s.a))errors.push(`${p.slug}:faq_${i+1}_legacy_generic`);
  answers.push({route:p.slug,index:i+1,text:s.a});add(exact,s.a,p.slug);add(patterns,norm(s.a),p.slug);
 }
 if((p.citation_velocity_artifacts||[]).length<1)errors.push(`${p.slug}:missing_decision_artifact`);else if((p.citation_velocity_artifacts||[]).filter(a=>a.type==='comparison_table').length<1)warnings.push(`${p.slug}:comparison_table_advisory`);
 if(!p.self_healing||p.self_healing.status!=='REPAIRED_AND_RESCORED')errors.push(`${p.slug}:self_heal_status`);
}
for(const p of automaticPages){
 if(!stagedAutomatic.has(p.slug))errors.push(`${p.slug}:automatic_page_missing_from_staged_source`);
 const autoSectionCount=(p.sections||[]).length;if(autoSectionCount<3)errors.push(`${p.slug}:automatic_insufficient_sections:${autoSectionCount}`);else if(autoSectionCount!==5)warnings.push(`${p.slug}:automatic_section_count_advisory:${autoSectionCount}`);
 if((p.source_records||[]).length<1)errors.push(`${p.slug}:automatic_sources_missing`);
 const resolved=(p.source_records||[]).map(id=>sourceMap.get(id));
 for(const [i,row] of resolved.entries())if(!row)errors.push(`${p.slug}:automatic_missing_source:${p.source_records[i]}`);else if(!/^https:\/\//.test(row.url||''))errors.push(`${p.slug}:automatic_non_https_source:${p.source_records[i]}`);
 if((p.source_urls||[]).length<1)errors.push(`${p.slug}:automatic_source_urls_missing`);
 if(!String(p.dated_primary_fact||'').match(/20\d{2}-\d{2}-\d{2}/))errors.push(`${p.slug}:automatic_dated_fact_missing`);
 const projected=wc([p.title,p.description,p.bodyHtml,p.dated_primary_fact,...(p.sections||[]).flatMap(s=>[s.q,s.a,...(s.checklist||[]),...(s.red_flags||[])])].join(' '));
 if(projected<200)errors.push(`${p.slug}:automatic_unusably_thin:${projected}`);else if(projected<450)warnings.push(`${p.slug}:automatic_depth_advisory:${projected}`);
 if(p.self_healing?.status!=='REPAIRED_AND_RESCORED'||p.self_healing?.stage!=='SOURCE_READY')errors.push(`${p.slug}:automatic_self_heal_status`);
 if(!Number.isInteger(p.self_healing?.projected_word_count)||p.self_healing.projected_word_count<200)errors.push(`${p.slug}:automatic_self_healing_unusable_words:${p.self_healing?.projected_word_count}`);else if(p.self_healing.projected_word_count<450)warnings.push(`${p.slug}:automatic_self_healing_depth_advisory:${p.self_healing.projected_word_count}`);
 if(!p.content_atom?.atom_id||!p.content_atom?.uniqueness_key)errors.push(`${p.slug}:automatic_page_atom_missing`);
 for(const [i,section] of (p.sections||[]).entries()){
  const count=wc(section.a);if(count<20||count>250)errors.push(`${p.slug}:automatic_section_${i+1}_unusable_length:${count}`);else if(count<45||count>110)warnings.push(`${p.slug}:automatic_section_${i+1}_length_advisory:${count}`);
  if(!section.content_atom?.atom_id||!section.content_atom?.uniqueness_key)errors.push(`${p.slug}:automatic_faq_${i+1}_atom_missing`);
  if(!String(section.a||'').toLowerCase().includes(String(p.title||'').replace(/[?]+$/,'').toLowerCase().slice(0,24)))errors.push(`${p.slug}:automatic_faq_${i+1}_topic_specificity`);
  automaticAnswers.push({route:p.slug,index:i+1,text:section.a});add(automaticExact,section.a,p.slug);add(automaticPatterns,norm(section.a),p.slug);
 }
}
if(stagedAutomatic.size!==automaticPages.length)errors.push(`automatic_staged_live_count_mismatch:${stagedAutomatic.size}/${automaticPages.length}`);
for(const [text,routes] of automaticExact)if(routes.length>1)errors.push(`automatic_duplicate_exact_answer:${routes.length}:${routes.slice(0,4).join(',')}`);
for(const [pattern,routes] of automaticPatterns)if(routes.length>5)warnings.push(`automatic_overused_normalized_pattern:${routes.length}:${routes.slice(0,4).join(',')}`);
if(automaticAnswers.length&&automaticExact.size<automaticAnswers.length)errors.push(`automatic_exact_uniqueness:${automaticExact.size}/${automaticAnswers.length}`);
for(const [text,routes] of exact)if(routes.length>1)errors.push(`duplicate_exact_answer:${routes.length}:${routes.slice(0,4).join(',')}`);
for(const [pattern,routes] of patterns)if(routes.length>12)warnings.push(`overused_normalized_pattern:${routes.length}:${routes.slice(0,4).join(',')}`);
const uniqueExact=exact.size,uniquePatterns=patterns.size;
if(uniqueExact<answers.length*.98)errors.push(`exact_uniqueness:${uniqueExact}/${answers.length}`);
if(uniquePatterns<200)warnings.push(`normalized_pattern_diversity_advisory:${uniquePatterns}`);
const report={validator:'programmatic-substance',status:errors.length?'FAIL':'PASS',state_pages:statePages.length,faq_answers:answers.length,unique_exact_answers:uniqueExact,unique_normalized_patterns:uniquePatterns,automatic_pages:automaticPages.length,automatic_faq_answers:automaticAnswers.length,automatic_unique_exact_answers:automaticExact.size,automatic_unique_normalized_patterns:automaticPatterns.size,max_normalized_pattern_use:Math.max(0,...[...patterns.values()].map(x=>x.length)),error_count:errors.length,warning_count:warnings.length,errors,warnings,checked_at:process.env.SOURCE_DATE||'2026-06-19'};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/programmatic-substance.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(`PROGRAMMATIC SUBSTANCE FAIL (${errors.length})`);console.error(errors.slice(0,80).join('\n'));process.exit(1);}console.log(`PROGRAMMATIC SUBSTANCE PASS: ${statePages.length} state pages / ${answers.length} state decision answers / ${uniquePatterns} state patterns; ${automaticPages.length} automatic pages / ${automaticAnswers.length} automatic decision answers.`);
