#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { deriveContentAtom } = require('./lib/content_atom');
const ROOT = path.resolve(__dirname, '..');
const DATE = process.env.SOURCE_DATE || '2026-06-19';
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const write = (p,v) => { const out=path.join(ROOT,p); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n'); };
const slugify = (s) => String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90);
const verticalMap = {pi:'personal_injury',personal_injury:'personal_injury',dentistry:'dentistry',trt:'trt',neuro:'neuro',uscis:'uscis-medical','uscis-medical':'uscis-medical'};
const targets = {personal_injury:'https://theaccidentguides.com/request-assistance/',dentistry:'https://dentistryguides.com/request-assistance/',trt:'https://hormonesivhair.com/request-assistance/',neuro:'https://neuroevalguides.com/request-assistance/','uscis-medical':'https://uscisexam.com/request-assistance/'};
const sourceDefaults = {personal_injury:['SRC-CONGRESS-STATE-LEGISLATURES','SRC-CORNELL-SOL'],dentistry:['SRC-ADA-MOUTHHEALTHY'],trt:['SRC-FDA-TESTOSTERONE'],neuro:['SRC-NIMH-ADHD'],'uscis-medical':['SRC-USCIS-I693']};
const approval = read('data/community/approval_queue.json');
const ready = (Array.isArray(approval)?approval:[]).filter((x)=>['APPROVED','READY_TO_PUBLISH'].includes(String(x.status||'').toUpperCase()));
const report = {schema_version:'1.0',run_date:DATE,approved:ready.length,created:[],skipped:[]};
if (!ready.length) { write('artifacts/validation/velocity-content-release.json',report); console.log('No approved public-signal pages to release.'); process.exit(0); }
for (const rel of ['content/_staged/pages.json','content/_live/pages.json']) {
  const payload=read(rel); const pages=payload.pages||[]; const existing=new Set(pages.map((p)=>p.slug));
  for (const item of ready) {
    const vertical=verticalMap[item.vertical];
    if (!vertical || !targets[vertical]) { report.skipped.push({id:item.id,reason:'unsupported_vertical'}); continue; }
    const question=String(item.query||item.normalized_query||'').trim();
    if (question.length<20) { report.skipped.push({id:item.id,reason:'question_too_short'}); continue; }
    const route=`/${vertical.replace('_','-')}/community-questions/${slugify(question)}/`;
    if (existing.has(route)) continue;
    const sourceRecords=Array.isArray(item.source_records)&&item.source_records.length?item.source_records:sourceDefaults[vertical];
    const sections=[
      {q:question,a:'Start with the governing primary source, verify the current date and jurisdiction, and separate general information from advice about your facts.'},
      {q:`Which sources should I verify for ${question}?`,a:'Open the visible primary sources and confirm that they still govern the exact issue.'},
      {q:`What should I compare before acting on ${question}?`,a:'Compare scope, timing, written costs or fees, provider qualifications, exceptions, and next steps.'},
      {q:`What are the red flags for ${question}?`,a:'Pause when a claim is undated, unsourced, outside the right jurisdiction, or presented with pressure.'},
      {q:`Where can I find a provider for ${question}?`,a:'Use Find a Provider to continue to the matching provider destination.'}
    ].map((s,i)=>({...s,visible_q:s.q,checklist:['Verify the current source','Get costs or fees in writing','Use Find a Provider for local help'],red_flags:['No current source','No written explanation','Pressure before questions are answered'],content_atom:deriveContentAtom({...s,checklist:['Verify the current source','Get costs or fees in writing','Use Find a Provider for local help'],red_flags:['No current source']},{sourceRoute:`${route}#faq-${i+1}`,title:s.q}),date_modified:DATE}));
    const page={slug:route,path:route,vertical,title:question,description:`${question} A source-first decision guide with five visible FAQs and a direct Find a Provider route.`,sections,canonical_target_url:targets[vertical],source_records:sourceRecords,content_atom:deriveContentAtom({title:question,checklist:['Define the exact decision','Verify the current primary source','Compare written terms','Find a provider'],red_flags:['No source or date']},{sourceRoute:route,title:question}),date_modified:DATE,publication_status:'ADMITTED',velocity_only_program:'AUTOMATIC_PUBLIC_SIGNAL_RELEASE',dated_primary_fact:`Primary-source set reviewed ${DATE}.`};
    pages.push(page); existing.add(route); report.created.push({id:item.id,route});
  }
  payload.pages=pages; write(rel,payload);
}
report.created=[...new Map(report.created.map((row)=>[row.route,row])).values()].sort((a,b)=>a.route.localeCompare(b.route));
report.created_count=report.created.length;
write('artifacts/validation/velocity-content-release.json',report);
console.log(`Created ${report.created_count} unique Velocity page(s) from approved signals.`);
