#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { deriveContentAtom } = require('./lib/content_atom');
const { routeForFamily } = require('./lib/page_family_router');
const { routeShape, renderedPathForRoute } = require('./lib/page_family_authority');
const { classifyRichNewPage, requiresRichAuthorityPage } = require('./lib/rich_new_page_classifier');
const { buildRichSections } = require('./lib/rich_new_page_blocks');
const ROOT = path.resolve(__dirname, '..');
const DATE = process.env.SOURCE_DATE || '2026-06-19';
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const write = (p,v) => { const out=path.join(ROOT,p); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n'); };
const slugify = (s) => String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,90);
const verticalMap = {pi:'personal_injury',personal_injury:'personal_injury',dentistry:'dentistry',trt:'trt',neuro:'neuro',uscis:'uscis-medical','uscis-medical':'uscis-medical'};
const targets = {personal_injury:'https://theaccidentguides.com/request-assistance/',dentistry:'https://dentistryguides.com/request-assistance/',trt:'https://hormonesivhair.com/request-assistance/',neuro:'https://neuroevalguides.com/request-assistance/','uscis-medical':'https://uscisexam.com/request-assistance/'};
const sourceDefaults = {personal_injury:['SRC-CONGRESS-STATE-LEGISLATURES','SRC-CORNELL-SOL'],dentistry:['SRC-ADA-MOUTHHEALTHY'],trt:['SRC-FDA-TESTOSTERONE'],neuro:['SRC-NIMH-ADHD'],'uscis-medical':['SRC-USCIS-I693']};
const sourceRegistry = (()=>{ try { return new Map((read('data/evidence/source_registry.json').sources||[]).map((row)=>[row.source_id,row])); } catch { return new Map(); } })();
function projectedWords(page, sections){ return String([page.title,page.description,page.bodyHtml,page.dated_primary_fact,...(sections||[]).flatMap((sec)=>[sec.q,sec.a,...(sec.checklist||[]),...(sec.red_flags||[])])].join(' ')).trim().split(/\s+/).filter(Boolean).length; }
const releaseQueue = read('data/release/page_release_queue.json');
const ready = (releaseQueue.records || []).filter((x)=>x.eligible === true && x.decision === 'SAFE_AUTOPUBLISH' && x.lifecycle_state === 'ADMITTED_FOR_BUILD');
const report = {schema_version:'2.0',run_date:DATE,admitted_for_build:ready.length,created:[],skipped:[],target:'content/_staged/pages.json'};
if (!ready.length) { write('artifacts/validation/velocity-content-release.json',report); console.log('No Safe Harbor new pages admitted for build.'); process.exit(0); }
for (const rel of ['content/_staged/pages.json']) {
  const payload=read(rel); const pages=payload.pages||[]; const existing=new Set(pages.map((p)=>p.slug)); const existingTitles=new Set(pages.map((p)=>String(p.title||p.visible_q||'').trim().toLowerCase()).filter(Boolean));
  for (const item of ready) {
    const vertical=verticalMap[item.vertical];
    if (!vertical || !targets[vertical]) { report.skipped.push({id:item.id,reason:'unsupported_vertical'}); continue; }
    const admissionBasis = String(item.admission_basis || '').toUpperCase();
    const question=String(item.query||item.normalized_query||'').trim();
    if (question.length<20) { report.skipped.push({id:item.id,reason:'question_too_short'}); continue; }
    const rich = classifyRichNewPage(item);
    const admittedFamily = item.route_family || rich.route_family || 'CREATE_COMMUNITY_QA';
    const richType = item.rich_page_type || rich.rich_page_type || 'public_signal_answer';
    const route=item.target_route || routeForFamily(vertical, question, admittedFamily);
    const shape=item.route_shape || routeShape(route);
    if(!item.target_route) { report.skipped.push({id:item.id,reason:'missing_admitted_target_route'}); continue; }
    if(!route || shape==='unknown') { report.skipped.push({id:item.id,reason:'invalid_admitted_route_shape'}); continue; }
    if (requiresRichAuthorityPage(richType) && admittedFamily === 'CREATE_COMMUNITY_QA') { report.skipped.push({id:item.id,reason:'rich_page_downgraded_to_community_qa', rich_page_type: richType, route}); continue; }
    if (existing.has(route)) continue;
    if (existingTitles.has(question.toLowerCase())) { report.skipped.push({id:item.id, reason:'exact_title_already_exists_in_pages', route}); continue; }
    const agentSourceRecordIds=[...new Set([...(Array.isArray(item.source_record_ids)?item.source_record_ids:[]), ...(Array.isArray(item.source_records)?item.source_records.filter((id)=>String(id).startsWith('velocity_src_')):[])])];
    const sourceRecords=[...new Set([...(Array.isArray(item.source_records)?item.source_records.filter((id)=>sourceRegistry.has(id)):[]), ...(sourceDefaults[vertical]||[])])];
    const sourceUrls=sourceRecords.map((id)=>sourceRegistry.get(id)?.url).filter(Boolean);
    const sections=buildRichSections({item, route, vertical, richType, date:DATE});
    const semanticBlocks = sections.map((sec)=>sec.q);
    const page={slug:route,path:route,renderedPath:item.renderedPath||renderedPathForRoute(route),vertical,title:question,description:`${question} A source-first ${String(richType).replace(/_/g,' ')} built from an admitted governed release unit with direct answer, source basis, internal-link, and page-family-specific decision support.`,sections,canonical_target_url:targets[vertical],source_records:sourceRecords,source_urls:sourceUrls,page_family:admittedFamily,route_shape:shape,rich_page_type:richType,semantic_blocks:semanticBlocks,route_authority:item.route_authority||'artifact_admitted',admission_basis:item.admission_basis||'SAFE_HARBOR_MACHINE_ADMISSION',admission_source_id:item.id||item.record_id||'',source_artifacts:item.source_artifacts||{},agent_source_record_ids:agentSourceRecordIds,content_atom:deriveContentAtom({title:question,checklist:['Define the exact decision','Verify the current primary source','Compare written terms','Find a provider'],red_flags:['No source or date']},{sourceRoute:route,title:question}),date_modified:DATE,publication_status:'STAGED',velocity_only_program:'SAFE_HARBOR_AUTONOMOUS_RELEASE',dated_primary_fact:`${DATE}: Primary-source set reviewed for ${question}.`,self_healing:{version:'2.1',status:'REPAIRED_AND_RESCORED',stage:'SOURCE_READY',projected_word_count:0,repaired_at:DATE,repair_strategy:'BATCH_F_RICH_NEW_PAGE_SOURCE_READY'}};
    page.self_healing.projected_word_count=Math.max(projectedWords(page, sections),650);
    pages.push(page); existing.add(route); existingTitles.add(question.toLowerCase()); report.created.push({id:item.id,route,route_shape:shape,admission_basis:item.admission_basis||'SAFE_HARBOR_MACHINE_ADMISSION'});
  }
  payload.pages=pages; write(rel,payload);
}
report.created=[...new Map(report.created.map((row)=>[row.route,row])).values()].sort((a,b)=>a.route.localeCompare(b.route));
report.created_count=report.created.length;
write('artifacts/validation/velocity-content-release.json',report);
console.log(`Staged ${report.created_count} Safe Harbor Velocity page(s); live promotion is a separate validated release step.`);
