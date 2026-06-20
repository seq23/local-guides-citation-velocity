#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path');
const ROOT=path.resolve(__dirname,'../..'); const errors=[];
const read=(p)=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const exists=(p)=>fs.existsSync(path.join(ROOT,p));
const walk=(dir)=>{const out=[]; if(!fs.existsSync(dir))return out; for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name); if(e.isDirectory())out.push(...walk(p)); else out.push(p);} return out;};
const specs=read('data/page_families/velocity_page_specs.json');
const stateSources=read('data/evidence/state_source_registry.json');
const sourceRegistry=read('data/evidence/source_registry.json');
const sourceIds=new Set((sourceRegistry.sources||[]).map((s)=>s.source_id));
if(stateSources.count!==50||stateSources.states.length!==50)errors.push(`expected 50 state authority records; got ${stateSources.states?.length||0}`);
if(stateSources.authority_record_count!==400)errors.push(`expected 400 state authority mappings; got ${stateSources.authority_record_count||0}`);
const authorityByRoute=new Map();
for(const state of stateSources.states||[]){
  if((state.authorities||[]).length!==8)errors.push(`expected 8 authority mappings for ${state.state}`);
  for(const authority of state.authorities||[]){
    if(!authority.route||authorityByRoute.has(authority.route))errors.push(`duplicate/missing authority route ${authority.route||state.state}`);
    else authorityByRoute.set(authority.route,authority);
    if(!authority.authority_url||/usa\.gov\/states/i.test(authority.authority_url))errors.push(`generic or missing authority URL ${authority.route}`);
    if(!authority.selection_instruction||authority.selection_instruction.length<30)errors.push(`authority selection instruction too thin ${authority.route}`);
    for(const id of authority.source_records||[])if(!sourceIds.has(id))errors.push(`unregistered source ${id} for ${authority.route}`);
  }
}
if(specs.count!==412||specs.pages.length!==412)errors.push(`expected 412 Velocity page specs; got ${specs.pages.length}`);
let statePageCount=0; let faqCount=0; const exactAnswers=new Set(); const normalizedAnswers=new Set();
const normalize=(text)=>String(text||'').toLowerCase().replace(/\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/g,'{state}').replace(/\b[a-z]{2}\b/g,'{abbr}').replace(/\d{4}-\d{2}-\d{2}/g,'{date}').replace(/[^a-z0-9{}]+/g,' ').trim();
for(const page of specs.pages){
  if(Object.prototype.hasOwnProperty.call(page,'legacy_candidate_id'))errors.push(`legacy candidate field remains ${page.slug}`);
  if(!page.slug.startsWith('/'+page.vertical.replace('_','-')+'/'))errors.push(`wrong Velocity route ${page.slug}`);
  if((page.sections||[]).length!==5)errors.push(`five FAQs missing ${page.slug}`);
  if(!/request-assistance\/$/.test(page.canonical_target_url||''))errors.push(`provider target missing ${page.slug}`);
  if(page.state){
    statePageCount++;
    const mapped=authorityByRoute.get(page.slug);
    if(!mapped)errors.push(`state authority mapping missing ${page.slug}`);
    if(!page.state_authority?.authority_url||/usa\.gov\/states/i.test(page.state_authority.authority_url))errors.push(`page authority missing or generic ${page.slug}`);
    if(mapped&&page.state_authority.authority_url!==mapped.authority_url)errors.push(`page authority URL mismatch ${page.slug}`);
    if(mapped&&page.state_authority.selection_instruction!==mapped.selection_instruction)errors.push(`page authority instruction mismatch ${page.slug}`);
    for(const id of page.source_records||[])if(!sourceIds.has(id))errors.push(`state source not registered ${page.slug}:${id}`);
    if(mapped&&!(mapped.source_records||[]).every((id)=>(page.source_records||[]).includes(id)))errors.push(`state authority sources not linked ${page.slug}`);
    if(!(page.citation_velocity_artifacts||[]).some((a)=>a.type==='comparison_table'&&/Evidence Map$/.test(a.title||'')))errors.push(`state evidence map missing ${page.slug}`);
    if(page.self_healing?.status!=='REPAIRED_AND_RESCORED'||page.self_healing?.stage!=='SOURCE_READY')errors.push(`self-healing status missing ${page.slug}`);
    if(!Number.isInteger(page.self_healing?.projected_word_count)||page.self_healing.projected_word_count<650)errors.push(`projected word count below floor ${page.slug}`);
    for(const section of page.sections||[]){
      faqCount++;
      if(!section.a||section.a.split(/\s+/).filter(Boolean).length<45)errors.push(`FAQ answer too short ${page.slug}:${section.q}`);
      if(!section.content_atom?.atom_id||!section.content_atom?.uniqueness_key)errors.push(`FAQ atom missing ${page.slug}:${section.q}`);
      exactAnswers.add(section.a);
      normalizedAnswers.add(normalize(section.a));
    }
  }
  const rendered=page.slug==='/'?path.join(ROOT,'index.html'):path.join(ROOT,page.slug.replace(/^\//,''),'index.html');
  if(!fs.existsSync(rendered))errors.push(`rendered route missing ${page.slug}`);
  else if(page.state){
    const html=fs.readFileSync(rendered,'utf8');
    if(!html.includes('data-state-authority="true"'))errors.push(`rendered state authority card missing ${page.slug}`);
    if(!html.includes(page.state_authority.authority_url))errors.push(`rendered authority URL missing ${page.slug}`);
    if(!html.includes(page.state_authority.authority_name))errors.push(`rendered authority name missing ${page.slug}`);
  }
}
if(statePageCount!==400)errors.push(`expected 400 state pages; got ${statePageCount}`);
if(faqCount!==2000)errors.push(`expected 2000 state FAQs; got ${faqCount}`);
if(exactAnswers.size!==2000)errors.push(`expected 2000 exact state FAQ answers; got ${exactAnswers.size}`);
if(normalizedAnswers.size<250)errors.push(`normalized answer diversity below 250; got ${normalizedAnswers.size}`);
for(const forbidden of ['data/canonical_candidates','data/lkg_candidates','scripts/export_promotion_candidates.js','scripts/community/export_lkg_candidates.js','.github/workflows/lkg_pr_push.yml']) if(exists(forbidden))errors.push(`forbidden LKG/candidate surface remains: ${forbidden}`);
const payload=read('content/_live/pages.json'); const programs=payload.pages.filter((p)=>['VELOCITY_QUESTION_200','VELOCITY_DISAMBIGUATOR_20'].includes(p.full_scope_program));
if(programs.filter((p)=>p.full_scope_program==='VELOCITY_QUESTION_200').length!==200)errors.push('question page count is not 200');
if(programs.filter((p)=>p.full_scope_program==='VELOCITY_DISAMBIGUATOR_20').length!==20)errors.push('disambiguator count is not 20');
for(const p of programs){if((p.sections||[]).length!==5)errors.push(`five FAQs missing ${p.slug}`); if(!p.dated_primary_fact)errors.push(`dated fact missing ${p.slug}`); if(!(p.source_urls||[]).length)errors.push(`source URLs missing ${p.slug}`);}
const required=['/personal-injury-vs-workers-comp/','/cosmetic-vs-general-dentistry/','/trt-vs-hair-loss-treatment/','/neuropsych-eval-vs-iq-test-vs-psych-eval/','/uscis-medical-exam-vs-physical/','/civil-surgeon-vs-panel-physician/','/dental-insurance-vs-medical-insurance/','/ssdi-eval-vs-school-iep-eval-vs-forensic-eval/'];
const slugs=new Set(programs.map((p)=>p.slug)); for(const r of required)if(!slugs.has(r))errors.push(`required disambiguator missing ${r}`);
const htmlFiles=walk(ROOT).filter((p)=>p.endsWith('.html')&&!p.includes('node_modules'));
for(const file of htmlFiles){const html=fs.readFileSync(file,'utf8'); const visible=html.replace(/href=["'][^"']*request-assistance[^"']*["']/gi,''); if(/request assistance/i.test(visible))errors.push(`banned visible CTA in ${path.relative(ROOT,file)}`);}
const home=fs.readFileSync(path.join(ROOT,'index.html'),'utf8'); for(const marker of ['Find a Provider','Canonical verticals','What we cover','Platform operations','Source first. Decision second. Provider third.'])if(!home.includes(marker))errors.push(`homepage marker missing: ${marker}`);
const disavow=fs.readFileSync(path.join(ROOT,'seo/disavow/theindustryguides.com-disavow.txt'),'utf8'); const requiredDomains=['analyticshaven.top','anchorurl.cloud','backlinks-checker.com','creativeposts.top','fiverr-affordable-seo-services.site','metamagic.top','screenshots.wiki']; for(const d of requiredDomains)if(!disavow.includes(`domain:${d}`))errors.push(`disavow domain missing ${d}`);
const evidence={validator:'velocity-only-overhaul',status:errors.length?'FAIL':'PASS',errors,counts:{velocity_specs:specs.pages.length,state_pages:statePageCount,state_authority_records:stateSources.authority_record_count,state_faqs:faqCount,exact_state_answers:exactAnswers.size,normalized_state_answers:normalizedAnswers.size,program_pages:programs.length,rendered_html:htmlFiles.length}}; fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true}); fs.writeFileSync(path.join(ROOT,'artifacts/validation/velocity-only-overhaul.json'),JSON.stringify(evidence,null,2)+'\n');
if(errors.length){console.error(errors.slice(0,80).join('\n'));process.exit(1);} console.log(`Velocity-only overhaul validation PASS: ${statePageCount} state pages, ${exactAnswers.size} exact FAQ answers, ${normalizedAnswers.size} normalized patterns`);
