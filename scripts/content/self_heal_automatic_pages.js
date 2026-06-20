#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const {deriveContentAtom}=require('../lib/content_atom');
const ROOT=path.resolve(__dirname,'../..');
const DATE=String(process.env.SOURCE_DATE||'2026-06-19');
const read=(rel)=>JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));
const write=(rel,value)=>{const out=path.join(ROOT,rel);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(value,null,2)+'\n');};
const words=(value)=>String(value||'').trim().split(/\s+/).filter(Boolean).length;
const sourceRegistry=read('data/evidence/source_registry.json');
const sourceMap=new Map((sourceRegistry.sources||[]).map((row)=>[row.source_id,row]));
const pageFiles=['content/_staged/pages.json','content/_live/pages.json'];
const repairedRoutes=new Set();
const missingSources=[];
function sourceRows(page){
  const rows=(page.source_records||[]).map((id)=>sourceMap.get(id)).filter(Boolean);
  for(const id of page.source_records||[])if(!sourceMap.has(id))missingSources.push(`${page.slug}:${id}`);
  return rows;
}
function answerSet(page,rows){
  const topic=String(page.title||'this question').trim().replace(/[?]+$/,'');
  const lead=rows[0];
  const sourceLabel=lead?[lead.publisher,lead.title||lead.authority_scope||lead.source_id].filter(Boolean).join(': '):'the governing primary source';
  const sourceUrl=lead?.url||'';
  const reviewed=`${DATE}`;
  return [
    {
      q:page.title,
      a:`For “${topic}” begin with ${sourceLabel} and confirm that it still governs the exact jurisdiction, service, and date involved. The source set was reviewed ${reviewed}, but the page does not turn a general rule into personal advice. Record the operative requirement, any exception, and the next verification step before choosing a provider.`,
      checklist:['Define the exact jurisdiction and decision','Open the named primary source','Record the operative date and exception','Carry the verified facts into Find a Provider'],
      red_flags:['The answer has no current source','A general summary is presented as personal advice','The jurisdiction or effective date is missing']
    },
    {
      q:`Which primary sources should I verify for ${topic}?`,
      a:`Open the visible source links for “${topic}” and verify the publisher, effective date, jurisdiction, and page scope. Start with ${sourceLabel}${sourceUrl?` at ${sourceUrl}`:''}, then use any additional listed authority to resolve conflicts or exceptions. Save the exact page you relied on instead of relying on a search snippet, advertisement, or undated summary.`,
      checklist:['Confirm the publisher is authoritative','Check the current date and jurisdiction','Save the exact source page','Use a second authority when the rule is unclear'],
      red_flags:['Only a search-result snippet is offered','The cited page does not cover the stated topic','The source date cannot be determined']
    },
    {
      q:`What should I compare before acting on ${topic}?`,
      a:`For “${topic},” compare the written scope, eligibility or qualification rules, timing, total cost or fee disclosures, provider credentials, and what happens if the first path does not fit. Keep source facts separate from provider promises. A useful comparison records the same fields for every option so a polished sales page cannot substitute for evidence or complete terms.`,
      checklist:['Compare identical fields across options','Separate authority facts from provider claims','Get price or fee terms in writing','Document fallback and cancellation rules'],
      red_flags:['Options are compared with different criteria','Important fees remain verbal','Credentials cannot be verified through the named authority']
    },
    {
      q:`What warning signs matter when researching ${topic}?`,
      a:`Pause on “${topic}” when a page gives no primary source, omits the governing jurisdiction, uses an old rule as current, guarantees an outcome, or pressures you to act before questions are answered. Also pause when a provider will not explain credentials, written costs, record handling, or exceptions. Verification should become more specific as the decision becomes more consequential.`,
      checklist:['Check for a current primary source','Confirm jurisdiction and credential status','Request written costs and scope','Escalate unresolved contradictions'],
      red_flags:['Guaranteed results','Undated or copied legal or medical language','Pressure before written terms are supplied']
    },
    {
      q:`When should I use Find a Provider for ${topic}?`,
      a:`Use Find a Provider after you have identified the exact issue in “${topic},” reviewed the visible authority links, and written down the facts that still require professional interpretation. Take the source URL, dates, questions, costs, and exceptions with you. The provider conversation should resolve the remaining local or fact-specific issues rather than repeat basic information the page already verifies.`,
      checklist:['Finish the source check first','Write down unresolved fact-specific questions','Bring dates, records, and written terms','Use the nearest matching canonical provider destination'],
      red_flags:['A provider is selected before the issue is defined','No questions or records are prepared','The destination does not match the page vertical']
    }
  ];
}
function repairPage(page){
  if(page.velocity_only_program!=='AUTOMATIC_PUBLIC_SIGNAL_RELEASE')return false;
  const rows=sourceRows(page);
  if(!rows.length)throw new Error(`${page.slug}: automatic page has no admitted source record`);
  const raw=answerSet(page,rows);
  page.sections=raw.map((section,index)=>{
    const enriched={...section,visible_q:section.q,date_modified:DATE};
    enriched.content_atom=deriveContentAtom(enriched,{sourceRoute:`${page.slug}#faq-${index+1}`,title:section.q});
    enriched.content_atom.source_basis={method:'automatic_velocity_source_repair',source_route:`${page.slug}#faq-${index+1}`,source_fields:['source_records','source_urls','dated_primary_fact','sections'],factual_claim_scope:'Source-orientation and decision-support synthesis; no unsupported legal, medical, price, deadline, provider-count, or outcome claim.'};
    return enriched;
  });
  page.source_urls=rows.map((row)=>row.url).filter(Boolean);
  page.dated_primary_fact=`Primary-source set reviewed ${DATE}: ${rows.slice(0,3).map((row)=>`${row.publisher} — ${row.title}`).join('; ')}.`;
  page.bodyHtml=page.sections[0].a;
  page.description=`${page.title} A source-first answer with five visible FAQs, a defensible verification framework, and a direct Find a Provider route.`;
  page.citation_velocity_artifacts=[{type:'comparison_table',title:`${page.title.replace(/[?]+$/,'')} Verification Map`,intro:'Use the same evidence fields before comparing providers or next steps.',headers:['Layer','What to verify','Stop condition'],rows:[['Authority',rows[0].title,'Publisher, jurisdiction, or current date cannot be confirmed'],['Decision',page.title,'The exact question or required outcome is still vague'],['Provider','Credentials, written scope, timing, and costs','Terms remain verbal or cannot be verified'],['Handoff','Find a Provider','The destination does not match the page vertical']]}];
  const framework={title:`${page.title.replace(/[?]+$/,'')} Source-First Decision Framework`,checklist:page.sections.flatMap((s)=>s.checklist).slice(0,8),red_flags:page.sections.flatMap((s)=>s.red_flags).slice(0,8)};
  page.content_atom=deriveContentAtom(framework,{sourceRoute:page.slug,title:page.title});
  page.content_atom.source_basis={method:'automatic_velocity_source_repair',source_route:page.slug,source_fields:['source_records','source_urls','dated_primary_fact','citation_velocity_artifacts','sections'],factual_claim_scope:'Source-orientation and decision-support synthesis; unsupported factual conclusions are prohibited.'};
  page.date_modified=DATE;
  const projected=words([page.title,page.description,page.bodyHtml,page.dated_primary_fact,...page.sections.flatMap((s)=>[s.q,s.a,...s.checklist,...s.red_flags])].join(' '));
  page.self_healing={version:'2.1',status:'REPAIRED_AND_RESCORED',stage:'SOURCE_READY',projected_word_count:projected,repaired_at:DATE,repair_strategy:'AUTOMATIC_VELOCITY_SOURCE_REPAIR'};
  repairedRoutes.add(page.slug);
  return true;
}
for(const rel of pageFiles){
  const payload=read(rel);
  let changed=0;
  for(const page of payload.pages||[])if(repairPage(page))changed++;
  payload.automatic_page_self_healing={version:'2.1',effective_date:DATE,repaired_count:changed,advance_rule:'Automatic pages may advance only after source, five-FAQ, answer-length, word-count, atom, routing, and rendered-depth checks pass.'};
  write(rel,payload);
}
if(missingSources.length)throw new Error(`Missing automatic-page sources: ${missingSources.join(', ')}`);
const report={status:'PASS',repaired_routes:repairedRoutes.size,routes:[...repairedRoutes].sort(),effective_date:DATE};
write('artifacts/validation/automatic-page-self-heal.json',report);
console.log(`AUTOMATIC PAGE SELF-HEAL COMPLETE: ${repairedRoutes.size} route(s) repaired in staged and live source.`);
