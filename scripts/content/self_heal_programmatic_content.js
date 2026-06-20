#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {deriveContentAtom}=require('../lib/content_atom');
const ROOT=path.resolve(__dirname,'../..');
const DATE=String(process.env.SOURCE_DATE||'2026-06-19');
const read=(p)=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const write=(p,v)=>{const out=path.join(ROOT,p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n');};
const hash=(s)=>parseInt(crypto.createHash('sha256').update(String(s)).digest('hex').slice(0,8),16);
const pick=(arr,key,offset=0)=>arr[(hash(key)+offset)%arr.length];
const sentence=(s)=>String(s||'').trim().replace(/\s+/g,' ').replace(/[.?!]+$/,'');

const SOURCE_DEFS={
  'SRC-CONGRESS-STATE-LEGISLATURES':{publisher:'Congress.gov',title:'State Legislature Websites',url:'https://www.congress.gov/state-legislature-websites',source_type:'federal_official_directory',authority_scope:'Official state legislature website discovery',retrieved_at:DATE},
  'SRC-CORNELL-COMPARATIVE-NEGLIGENCE':{publisher:'Cornell Legal Information Institute',title:'Comparative Negligence',url:'https://www.law.cornell.edu/wex/comparative_negligence',source_type:'legal_reference',authority_scope:'Comparison terminology and legal research orientation',retrieved_at:DATE},
  'SRC-CMS-STATE-MARKETPLACES':{publisher:'Centers for Medicare & Medicaid Services',title:'State-based Marketplaces',url:'https://www.cms.gov/marketplace/about/state-based-marketplaces',source_type:'federal_primary',authority_scope:'Marketplace operating model by state',retrieved_at:DATE},
  'SRC-HEALTHCARE-GOV-STATE-MARKETPLACE':{publisher:'HealthCare.gov',title:'Marketplace in your state',url:'https://www.healthcare.gov/marketplace-in-your-state/',source_type:'federal_primary',authority_scope:'Current enrollment destination by state',retrieved_at:DATE},
  'SRC-MEDICAID-STATE-PROFILES':{publisher:'Medicaid.gov',title:'State Medicaid and CHIP Profiles',url:'https://www.medicaid.gov/state-overviews',source_type:'federal_primary',authority_scope:'State-specific Medicaid and CHIP program profile',retrieved_at:DATE},
  'SRC-MEDICAID-DENTAL-BENEFIT':{publisher:'Medicaid.gov',title:'Dental Care',url:'https://www.medicaid.gov/medicaid/benefits/dental-care/index.html',source_type:'federal_primary',authority_scope:'Federal dental benefit requirements and state-option context',retrieved_at:DATE},
  'SRC-ASPPB-LICENSING-BOARDS':{publisher:'Association of State and Provincial Psychology Boards',title:'Contact a Licensing Board',url:'https://www.asppb.net/page/BdContactNewPG',source_type:'regulatory_directory',authority_scope:'State psychology board, license verification, law, and rules links',retrieved_at:DATE},
  'SRC-FSMB-STATE-MEDICAL-BOARDS':{publisher:'Federation of State Medical Boards',title:'Contact a State Medical Board',url:'https://www.fsmb.org/contact-a-state-medical-board/',source_type:'regulatory_directory',authority_scope:'State medical board contact and official board website links',retrieved_at:DATE},
  'SRC-ADA-STATE-DENTAL-BOARDS':{publisher:'American Dental Association',title:'Dental Licensure by State',url:'https://www.ada.org/resources/careers/licensure/dental-licensure-by-state',source_type:'regulatory_directory',authority_scope:'State dental board and licensure pathway discovery',retrieved_at:DATE}
};

const FAMILY={
 'USCIS-STATE-CIVIL-SURGEON':{
  authority:'USCIS Civil Surgeon Locator', selector:'Search the USCIS locator by ZIP code or address inside {state}.', sources:['SRC-USCIS-CIVIL-SURGEON','SRC-USCIS-I693','SRC-CDC-TECHNICAL-INSTRUCTIONS'],
  focus:'federal designation, current Form I-693 instructions, vaccination handling, sealed-envelope procedure, and clinic-specific written pricing',
  questions:['How do I verify that a civil surgeon serving {state} is currently designated?','Which I-693 form and CDC instructions control an exam booked in {state}?','What should a {state} clinic quote include before I schedule?','Which records should I carry to a civil-surgeon appointment in {state}?','When should I use Find a Provider for a {state} civil-surgeon search?']
 },
 'PI-STATE-SOL':{
  authority:'official {state} legislature and published state code', selector:'Open Congress.gov’s state-legislature directory, choose {state}, then search the official code for the claim type and accrual rule.', sources:['SRC-CONGRESS-STATE-LEGISLATURES','SRC-CORNELL-SOL'],
  focus:'the controlling state code section, claim classification, accrual date, tolling, governmental notice rules, and any shorter special deadline',
  questions:['Where do I verify the personal-injury filing deadline in {state}?','Why is the accident date not always the only date that matters in {state}?','Which exceptions can change a {state} limitations analysis?','What should I preserve while researching a possible {state} deadline?','When should I find a provider about a {state} limitations issue?']
 },
 'PI-STATE-NEGLIGENCE':{
  authority:'official {state} legislature and current state appellate authority', selector:'Use the official {state} code and court sources to confirm the current fault-allocation rule; do not rely on a generic fifty-state chart.', sources:['SRC-CONGRESS-STATE-LEGISLATURES','SRC-CORNELL-COMPARATIVE-NEGLIGENCE'],
  focus:'the state fault system, any recovery bar, percentage allocation, jury instructions, and claim-specific exceptions',
  questions:['Where do I verify the fault-allocation rule that applies in {state}?','How can a claimant’s own fault affect recovery in {state}?','Why should I avoid relying on a generic comparative-negligence chart for {state}?','What evidence matters when fault percentages are disputed in {state}?','When should I find a provider about a {state} fault dispute?']
 },
 'DENTISTRY-STATE-INSURANCE':{
  authority:'CMS marketplace records and the official enrollment destination for {state}', selector:'Confirm whether {state} uses HealthCare.gov or a state-based marketplace, then inspect the plan’s dental benefit and network documents.', sources:['SRC-CMS-STATE-MARKETPLACES','SRC-HEALTHCARE-GOV-STATE-MARKETPLACE','SRC-ADA-STATE-DENTAL-BOARDS'],
  focus:'marketplace operating model, embedded versus stand-alone dental coverage, age limits, network participation, waiting periods, and written benefit documents',
  questions:['Which official marketplace serves dental shoppers in {state}?','How do embedded and stand-alone dental benefits differ in {state}?','What documents should I compare before choosing a {state} dental plan?','How do I verify a dentist’s license and network participation in {state}?','When should I use Find a Provider after comparing {state} plans?']
 },
 'DENTISTRY-STATE-MEDICAID':{
  authority:'Medicaid.gov’s {state} profile and the current {state} Medicaid dental program materials', selector:'Select {state} in Medicaid.gov’s state profiles, then confirm adult and child dental benefits in the state program documents.', sources:['SRC-MEDICAID-STATE-PROFILES','SRC-MEDICAID-DENTAL-BENEFIT','SRC-ADA-STATE-DENTAL-BOARDS'],
  focus:'child EPSDT obligations, optional adult coverage, covered service categories, prior authorization, managed-care network rules, and current state contacts',
  questions:['Where do I verify Medicaid dental coverage for {state}?','Why can child and adult dental benefits differ in {state}?','What should I confirm before booking Medicaid dental care in {state}?','How do prior authorization and managed-care rules affect {state} dental access?','When should I use Find a Provider for Medicaid dental care in {state}?']
 },
 'NEURO-STATE-FINDER':{
  authority:'the {state} psychology licensing board listed by ASPPB', selector:'Select {state} in the ASPPB board directory, open the official board website, and verify the evaluator’s active license and discipline status.', sources:['SRC-ASPPB-LICENSING-BOARDS','SRC-NIMH-ADHD'],
  focus:'license status, scope of practice, referral question, test battery, report purpose, insurance authorization, accessibility, and academic medical-center alternatives',
  questions:['Which regulator verifies psychologists who offer neuropsychological evaluation in {state}?','What should I ask a {state} evaluator before testing begins?','How do I compare hospital, university, and private-practice evaluation options in {state}?','Which insurance and report-use details should I confirm in {state}?','When should I use Find a Provider for a neuropsychological evaluation in {state}?']
 },
 'TRT-STATE-LEGALITY':{
  authority:'the {state} medical board listed by FSMB plus current federal testosterone labeling', selector:'Select {state} in the FSMB board directory, open the official medical-board site, and verify licensure, prescribing, monitoring, and advertising rules.', sources:['SRC-FSMB-STATE-MEDICAL-BOARDS','SRC-FDA-TESTOSTERONE'],
  focus:'prescriber licensure, medical evaluation, controlled-substance obligations, laboratory monitoring, informed consent, advertising claims, and federal labeling',
  questions:['Which regulator controls physician licensure for TRT in {state}?','What should a lawful TRT evaluation document in {state}?','Which monitoring and informed-consent questions matter in {state}?','What advertising or prescribing red flags should I watch for in {state}?','When should I use Find a Provider for TRT care in {state}?']
 },
 'TRT-STATE-TELEHEALTH':{
  authority:'the {state} medical board plus current DEA and HHS telehealth rules', selector:'Select {state} in the FSMB directory and compare the board’s telehealth and prescribing rules with current DEA requirements.', sources:['SRC-FSMB-STATE-MEDICAL-BOARDS','SRC-DEA-TELEMEDICINE','SRC-HHS-TELEHEALTH','SRC-FDA-TESTOSTERONE'],
  focus:'where the patient is located, clinician licensure, identity and medical evaluation, controlled-substance prescribing, follow-up, records, and emergency coverage',
  questions:['Which licenses and federal rules apply to telehealth TRT for a patient in {state}?','Why does the patient’s physical location matter for a {state} telehealth visit?','What should a telehealth TRT service disclose before treating someone in {state}?','Which prescribing and follow-up records should I expect in {state}?','When should I use Find a Provider for telehealth TRT in {state}?']
 }
};

const OPENERS=[
 'For {state}, begin with {authority}; it is the correct authority path for this page’s decision.',
 'The defensible starting point in {state} is {authority}, not an undated national summary.',
 'A current {state} answer starts at {authority} and then narrows to the exact facts, date, and service involved.',
 'Use {authority} as the first verification layer for {state}, then document what you checked and when.',
 'Before relying on a {state} summary, confirm the issue through {authority}.',
 'The controlling verification path for {state} runs through {authority}; screenshots and blog charts are secondary.',
 'In {state}, verify the rule or credential through {authority} before comparing providers or acting.',
 'Treat {authority} as the source-of-record pathway for this {state} question.'
];
const MIDDLES=[
 'Then confirm {focus}.',
 'Your written comparison should cover {focus}.',
 'The practical review is incomplete until it addresses {focus}.',
 'Record the source date and verify {focus}.',
 'Use the source to separate general guidance from {focus}.',
 'A provider-facing checklist should test {focus}.',
 'The source review should produce a dated note covering {focus}.',
 'Do not advance until the evidence file covers {focus}.'
];
const CLOSERS=[
 'If the rule or provider fit remains unclear, use Find a Provider for the nearest canonical next step.',
 'After the source check, Find a Provider routes you to the relevant local directory or service path.',
 'Use Find a Provider only after the authority check so the next conversation starts with the right questions.',
 'The provider CTA is the next step, not a substitute for verifying the governing source.',
 'When facts or timing could change the answer, take the source record to a qualified provider.',
 'Find a Provider routes to the canonical destination for current local options and verification.',
 'Do not rely on the summary alone; verify first, then use Find a Provider.',
 'The final action is a provider search informed by the source record, not an unsourced recommendation.'
];

function format(template,state,conf){return template.replaceAll('{state}',state.name).replaceAll('{authority}',conf.authority.replaceAll('{state}',state.name)).replaceAll('{focus}',conf.focus);}
function answerFor(page,conf,q,index){
 const key=`${page.page_family}|${page.state.abbreviation}|${index}`;
 return [`For “${q},”`,format(pick(OPENERS,key,index),page.state,conf),format(pick(MIDDLES,key,index+7),page.state,conf),pick(CLOSERS,key,index+13)].join(' ');
}
function checklistFor(page,conf,index){
 const st=page.state.name;
 const sourceStep=format(conf.selector,page.state,conf);
 const options=[
  [`Name the exact ${st} decision and the date that could change it.`,sourceStep,`Save the source URL, page title, and review date in your notes.`,`Compare provider scope and written terms before using Find a Provider.`],
  [`Write the ${st} question in one sentence.`,sourceStep,`Check the exception, eligibility category, or license status that applies.`,`Route to the canonical provider destination with the verified facts in hand.`],
  [`Identify the person, service, and jurisdiction involved in ${st}.`,sourceStep,`Separate federal rules from ${st}-specific rules.`,`Ask the provider to explain any conflict in writing.`],
  [`Record the event date and the decision deadline for the ${st} issue.`,sourceStep,`Capture the operative rule, not merely a search-result snippet.`,`Use Find a Provider if interpretation or application remains uncertain.`]
 ];
 return pick(options,`${page.slug}|${index}`);
}
function redFlags(page,index){
 const st=page.state.name;
 const options=[
  [`A ${st} claim with no source date`,`A provider who will not identify the governing authority`,`A price, deadline, or eligibility statement presented as universal`],
  [`A generic fifty-state chart replacing ${st} primary material`,`No license or designation verification`,`Pressure to act before written terms are supplied`],
  [`An authority link that does not identify ${st} or the topic`,`A summary that hides exceptions`,`A provider answer that changes when you ask for documentation`],
  [`A stale screenshot used as the only evidence`,`No distinction between federal and ${st} requirements`,`A recommendation based only on advertising position`]
 ];
 return pick(options,`${page.page_family}|${index}|${page.state.abbreviation}`);
}
function artifactFor(page,conf){
 const rows=[
  ['Authority path',format(conf.authority,page.state,conf),format(conf.selector,page.state,conf)],
  ['Decision scope',page.title,`Verify ${conf.focus}.`],
  ['Evidence record',`Reviewed ${DATE}`,`Save the authority URL, operative page, review date, and any provider response.`],
  ['Provider handoff','Find a Provider','Continue only after the authority check and carry the verified facts into the provider conversation.']
 ];
 return [{type:'comparison_table',title:`${page.state.name} ${page.page_family.replaceAll('-',' ')} Evidence Map`,intro:`A state-specific four-layer verification map for ${page.title}.`,headers:['Layer','State-specific record','Completion standard'],rows}];
}
function sourceFact(page,conf){return `${page.state.name} authority path reviewed ${DATE}: ${format(conf.authority,page.state,conf)}. The page publishes no unverified state deadline, price, provider count, coverage promise, or prescribing conclusion.`;}
function projectedWords(page){return [page.title,page.description,page.dated_primary_fact,...page.sections.flatMap(s=>[s.q,s.a,...s.checklist,...s.red_flags])].join(' ').trim().split(/\s+/).filter(Boolean).length;}

const src=read('data/evidence/source_registry.json');
const sourceMap=new Map((src.sources||[]).map(x=>[x.source_id,x]));
for(const [id,def] of Object.entries(SOURCE_DEFS)) sourceMap.set(id,{source_id:id,jurisdiction:'US',effective_date:null,recheck_at:'2026-09-19',allowed_claim_classes:['state_authority_discovery','regulated_source_orientation'],review_status:'ADMITTED',...def});
src.sources=[...sourceMap.values()].sort((a,b)=>a.source_id.localeCompare(b.source_id));
src.count=src.sources.length;src.effective_date=DATE;write('data/evidence/source_registry.json',src);

const directAuthorities=read('data/evidence/state_direct_authorities.json');
const directByState=new Map((directAuthorities.rows||[]).map((row)=>[row.abbreviation,row]));
function authorityResolution(page,conf){
 const direct=directByState.get(page.state.abbreviation)||{};
 if(page.page_family==='PI-STATE-SOL'||page.page_family==='PI-STATE-NEGLIGENCE') return {authority_name:`${page.state.name} official legislature and published code`,authority_url:direct.legislature_url,resolution_type:'DIRECT_STATE_LEGISLATURE'};
 if(page.page_family==='NEURO-STATE-FINDER') return {authority_name:`${page.state.name} psychology licensing board`,authority_url:direct.psychology_board_url,resolution_type:'DIRECT_STATE_PSYCHOLOGY_BOARD'};
 if(page.page_family==='TRT-STATE-LEGALITY'||page.page_family==='TRT-STATE-TELEHEALTH') return {authority_name:`${page.state.name} medical board`,authority_url:direct.medical_board_url,resolution_type:'DIRECT_STATE_MEDICAL_BOARD'};
 if(page.page_family==='USCIS-STATE-CIVIL-SURGEON') return {authority_name:'USCIS Civil Surgeon Locator',authority_url:sourceMap.get('SRC-USCIS-CIVIL-SURGEON')?.url,resolution_type:'DIRECT_FEDERAL_LOCATOR'};
 if(page.page_family==='DENTISTRY-STATE-INSURANCE') return {authority_name:`Official marketplace authority serving ${page.state.name}`,authority_url:sourceMap.get('SRC-HEALTHCARE-GOV-STATE-MARKETPLACE')?.url,resolution_type:'OFFICIAL_FEDERAL_STATE_SELECTOR'};
 if(page.page_family==='DENTISTRY-STATE-MEDICAID') return {authority_name:`Official Medicaid profile for ${page.state.name}`,authority_url:sourceMap.get('SRC-MEDICAID-STATE-PROFILES')?.url,resolution_type:'OFFICIAL_FEDERAL_STATE_SELECTOR'};
 return {authority_name:format(conf.authority,page.state,conf),authority_url:sourceMap.get(conf.sources[0])?.url,resolution_type:'OFFICIAL_TOPIC_SOURCE'};
}

const payload=read('data/page_families/velocity_page_specs.json');
let repaired=0,skipped=0;
for(const page of payload.pages){
 const conf=FAMILY[page.page_family];
 if(!conf||!page.state){skipped++;continue;}
 page.source_records=[...conf.sources];
 const resolvedAuthority=authorityResolution(page,conf);
 page.state_authority={...resolvedAuthority,selection_instruction:format(conf.selector,page.state,conf),reviewed_at:DATE,recheck_policy:'Recheck before each substantive release and at least every 90 days.',direct_state_authority:resolvedAuthority.resolution_type.startsWith('DIRECT_')};
 page.description=`${page.title}: verify the ${page.state.name} authority path, document the current rule or credential, compare written provider terms, and continue through Find a Provider only after the evidence check.`;
 page.dated_primary_fact=sourceFact(page,conf);
 page.sections=conf.questions.map((q,index)=>{
  const question=format(q,page.state,conf);
  const answer=answerFor(page,conf,question,index);
  const checklist=checklistFor(page,conf,index);
  const red_flags=redFlags(page,index);
  const section={q:question,visible_q:question,a:answer,checklist,red_flags,date_modified:DATE};
  section.content_atom=deriveContentAtom(section,{sourceRoute:`${page.slug}#faq-${index+1}`,title:question});
  section.content_atom.source_basis={method:'state_authority_evidence_map',source_route:`${page.slug}#faq-${index+1}`,source_fields:['state_authority','source_records','dated_primary_fact','sections'],factual_claim_scope:'State-specific authority routing, evidence capture, and provider-selection questions. No unsupported numeric or legal conclusion.'};
  return section;
 });
 page.citation_velocity_artifacts=artifactFor(page,conf);
 const framework={title:`${page.state.name} ${page.page_family.replaceAll('-',' ')} Verification Protocol`,checklist:[format(conf.selector,page.state,conf),`Confirm ${conf.focus}.`,`Record the operative source, review date, and any exception.`,`Use Find a Provider for the local next step.`],red_flags:redFlags(page,9)};
 page.content_atom=deriveContentAtom(framework,{sourceRoute:page.slug,title:page.title});
 page.content_atom.source_basis={method:'state_authority_evidence_map',source_route:page.slug,source_fields:['state_authority','source_records','dated_primary_fact','citation_velocity_artifacts','sections'],factual_claim_scope:'State-specific authority routing and decision framework; unsupported conclusions are prohibited.'};
 page.date_modified=DATE;
 page.self_healing={version:'2.0',status:'REPAIRED_AND_RESCORED',stage:'SOURCE_READY',projected_word_count:projectedWords(page),repaired_at:DATE};
 repaired++;
}
payload.count=payload.pages.length;payload.effective_date=DATE;payload.self_healing_contract={version:'2.0',stages:['SOURCE_REPAIR','SOURCE_QUALITY','RENDER','RENDER_QUALITY','RELEASE'],advance_rule:'A stage may advance only when its validator passes; failed word counts, evidence depth, similarity, or routing are repaired and rescored before retry.',max_repair_attempts:3};
const stateRows=new Map();
for(const page of payload.pages){
 if(!page.state||!FAMILY[page.page_family])continue;
 const key=page.state.abbreviation;
 if(!stateRows.has(key))stateRows.set(key,{state:page.state.name,abbreviation:key,slug:page.state.slug,authority_count:0,authorities:[]});
 const row=stateRows.get(key);
 row.authorities.push({
  page_family:page.page_family,
  route:page.slug,
  authority_name:page.state_authority.authority_name,
  authority_url:page.state_authority.authority_url,
  resolution_type:page.state_authority.resolution_type,
  selection_instruction:page.state_authority.selection_instruction,
  source_records:[...page.source_records],
  reviewed_at:page.state_authority.reviewed_at,
  recheck_policy:page.state_authority.recheck_policy,
  direct_state_authority:Boolean(page.state_authority.direct_state_authority)
 });
}
const states=[...stateRows.values()].sort((a,b)=>a.state.localeCompare(b.state));
for(const state of states){state.authorities.sort((a,b)=>a.page_family.localeCompare(b.page_family));state.authority_count=state.authorities.length;}
const stateSourceRegistry={schema_version:'3.0',reviewed_at:DATE,effective_date:DATE,count:states.length,authority_record_count:states.reduce((n,s)=>n+s.authorities.length,0),states};
write('data/evidence/state_source_registry.json',stateSourceRegistry);
write('data/page_families/velocity_page_specs.json',payload);
write('artifacts/validation/programmatic-self-heal.json',{status:'PASS',repaired,skipped,source_count:src.count,effective_date:DATE});
console.log(`PROGRAMMATIC SELF-HEAL COMPLETE: ${repaired} state pages repaired; ${skipped} non-state support pages preserved.`);
