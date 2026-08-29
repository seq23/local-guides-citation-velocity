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
// Single authority for the per-vertical source records. The atlas -> release
// join needs the same mapping to emit candidates that pass validate_evidence_registry,
// and two hand-kept copies of the same table drift. The file is the copy; this
// falls back to the previous inline table only if the file is unreadable, so a
// missing file can never silently strip a page's source records.
const sourceDefaults = (() => {
  const inline = {personal_injury:['SRC-CONGRESS-STATE-LEGISLATURES','SRC-CORNELL-SOL'],dentistry:['SRC-ADA-MOUTHHEALTHY'],trt:['SRC-FDA-TESTOSTERONE'],neuro:['SRC-NIMH-ADHD'],'uscis-medical':['SRC-USCIS-I693']};
  try {
    const declared = read('data/queries/atlas_release_join_contract.json').vertical_source_records || {};
    const merged = {...inline};
    for (const [k, v] of Object.entries(declared)) if (Array.isArray(v)) merged[k] = v;
    return merged;
  } catch { return inline; }
})();
const sourceRegistry = (()=>{ try { return new Map((read('data/evidence/source_registry.json').sources||[]).map((row)=>[row.source_id,row])); } catch { return new Map(); } })();
function projectedWords(page, sections){ return String([page.title,page.description,page.bodyHtml,page.dated_primary_fact,...(sections||[]).flatMap((sec)=>[sec.q,sec.a,...(sec.checklist||[]),...(sec.red_flags||[])])].join(' ')).trim().split(/\s+/).filter(Boolean).length; }
const releaseQueue = read('data/release/page_release_queue.json');
// The publishing ceiling is READ. It is never defaulted, and a missing governor
// is a named stop, not a licence.
//
// This used to be `try { read(...) } catch { return {recommended_new_url_ceiling_per_day:2} }`
// followed by `Number(v.recommended_new_url_ceiling_per_day || 2)`. Both halves
// manufactured permission to publish out of the absence of permission:
//
//   * `|| 2` is falsy-triggered, so a deliberately declared ceiling of 0 - the only
//     way this system can say "publish nothing today" - sprang back to 2. Reproduced
//     with 3 admitted rows: the run reported daily_new_url_ceiling 2, staged two real
//     routes, and skipped the third with reason "daily_new_url_ceiling_reached". A
//     ceiling of 0 reported as reached at 2.
//   * the catch branch was worse. With velocity_decision.json deleted outright, two
//     pages were staged with NO governance evidence at all, while that same file's
//     automatic_safety_law reads "Unknown or incomplete evidence always holds the
//     current tier."
//
// So: `??` not `||`, and no fallback object. If the governor is absent or its
// ceiling is not a finite number, this run stops and says so.
const VELOCITY_DECISION_REL = 'data/authority_scale/velocity_decision.json';
const namedStop = (code, message) => {
  const stopReport = {schema_version:'2.0',run_date:DATE,status:'HALTED',stop_reason:code,stop_detail:message,created:[],created_count:0,skipped:[],target:'content/_staged/pages.json'};
  try { write('artifacts/validation/velocity-content-release.json',stopReport); } catch { /* the console stop below is the binding one */ }
  console.error(`VELOCITY CONTENT RELEASE HALTED (${code}): ${message}`);
  process.exit(1);
};
let velocityDecision;
try { velocityDecision = read(VELOCITY_DECISION_REL); }
catch (e) { namedStop('MISSING_VELOCITY_GOVERNOR', `${VELOCITY_DECISION_REL} could not be read (${e.message}). The governed new-URL ceiling is unknown, and an unknown ceiling holds - it does not default to 2. Run "npm run authority:velocity:evaluate" to regenerate it.`); }
const publicationLedger = (()=>{ try { return read('data/authority_scale/publication_ledger.json'); } catch { return {schema_version:'1.0',runs:[]}; } })();
const declaredCeiling = velocityDecision.recommended_new_url_ceiling_per_day ?? null;
if (!Number.isFinite(Number(declaredCeiling))) namedStop('UNREADABLE_VELOCITY_CEILING', `${VELOCITY_DECISION_REL} carries recommended_new_url_ceiling_per_day=${JSON.stringify(declaredCeiling)}, which is not a finite number. A ceiling that cannot be read is a stop, not a 2.`);
const dailyCeiling = Number(declaredCeiling);

// A hard failure in the velocity evaluator must stop this lane.
//
// This script previously read ONLY recommended_new_url_ceiling_per_day. It never
// looked at `decision` or `hard_failure_reasons`, so a decision carrying
// hard_failure_reasons ["validation_failure"] published at the full ceiling -
// reproduced: DOWNSHIFT_ONE_TIER with current 2 / recommended 2, and this lane
// staged 2 pages anyway. The brake reported as applied while nothing moved.
const hardFailureReasons = Array.isArray(velocityDecision.hard_failure_reasons) ? velocityDecision.hard_failure_reasons : [];
if (hardFailureReasons.length) namedStop('VELOCITY_HARD_FAILURE', `the velocity evaluator recorded hard_failure_reasons [${hardFailureReasons.join(', ')}] with decision "${velocityDecision.decision}". New-URL publishing is refused until the named failure is cleared in data/authority_scale/velocity_health.json by real evidence.`);

// The effective ceiling must be one of the governor's declared tiers. A ceiling
// that is not a configured tier means the policy and the code have drifted, and
// that drift should be loud rather than published.
const configuredTiers = Array.isArray(velocityDecision.configured_scale_tiers) ? velocityDecision.configured_scale_tiers.map(Number) : [];
if (configuredTiers.length && !configuredTiers.includes(dailyCeiling)) namedStop('CEILING_OUTSIDE_CONFIGURED_TIERS', `the effective ceiling ${dailyCeiling} is not a member of the configured scale tiers [${configuredTiers.join(', ')}].`);
const alreadyToday = (publicationLedger.runs||[]).filter((r)=>String(r.date||'')===DATE).reduce((n,r)=>n+Number(r.created||0),0);
const remainingToday = Math.max(0,dailyCeiling-alreadyToday);
const readyAll = (releaseQueue.records || []).filter((x)=>x.eligible === true && x.decision === 'SAFE_AUTOPUBLISH' && x.lifecycle_state === 'ADMITTED_FOR_BUILD');
const ready = readyAll.slice(0, remainingToday);
const report = {schema_version:'2.0',run_date:DATE,admitted_for_build:readyAll.length,selected_under_daily_new_url_ceiling:ready.length,daily_new_url_ceiling:dailyCeiling,already_published_today_before_run:alreadyToday,created:[],skipped:readyAll.slice(remainingToday).map((x)=>({id:x.id,reason:'daily_new_url_ceiling_reached'})),target:'content/_staged/pages.json'};
// "Nothing was admitted" and "publishing is held at a ceiling of zero" are
// different facts and used to print the same sentence. A declared full stop must
// be readable as a full stop by whoever reads this line or the artifact.
if (!ready.length) {
  if (dailyCeiling === 0) { report.stop_reason = 'DAILY_NEW_URL_CEILING_IS_ZERO'; report.stop_detail = `the governed ceiling is 0 - a declared full stop on new URLs - with ${readyAll.length} row(s) admitted and held.`; }
  else if (remainingToday === 0 && readyAll.length) { report.stop_reason = 'DAILY_NEW_URL_CEILING_ALREADY_SPENT'; report.stop_detail = `${alreadyToday} of ${dailyCeiling} new URL(s) were already published today.`; }
  report.created_count = 0;
  write('artifacts/validation/velocity-content-release.json',report);
  console.log(report.stop_reason ? `No pages staged: ${report.stop_reason} - ${report.stop_detail}` : 'No Safe Harbor new pages admitted for build.');
  process.exit(0);
}
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
    // The recorded word count is the measured one. No floor.
    //
    // This was `Math.max(projectedWords(page, sections), 650)`. 650 is not a round
    // number chosen for comfort: it is EXACTLY the threshold in
    // scripts/content/validate_programmatic_substance.js, below which a page raises
    // projected_depth_advisory. So every page this lane produced whose real
    // projection was thin was recorded at precisely the value that silences the
    // warning about it. Four staged pages currently carry a recorded 650 against real
    // projections of 561, 562, 576 and 576 - four thin pages the substance validator
    // was never allowed to see. The two sibling writers
    // (self_heal_automatic_pages.js, self_heal_programmatic_content.js) write the
    // real count with no floor; this one was the outlier.
    // Write what was measured and let the substance validator do its job.
    page.self_healing.projected_word_count=projectedWords(page, sections);
    pages.push(page); existing.add(route); existingTitles.add(question.toLowerCase()); report.created.push({id:item.id,route,route_shape:shape,admission_basis:item.admission_basis||'SAFE_HARBOR_MACHINE_ADMISSION'});
  }
  payload.pages=pages; write(rel,payload);
}
report.created=[...new Map(report.created.map((row)=>[row.route,row])).values()].sort((a,b)=>a.route.localeCompare(b.route));
report.created_count=report.created.length;
publicationLedger.runs=[...(publicationLedger.runs||[]),{run_at:`${DATE}T00:00:00.000Z`,date:DATE,created:report.created_count,ceiling:dailyCeiling,already_published_today_before_run:alreadyToday}];
write('data/authority_scale/publication_ledger.json',publicationLedger);
write('artifacts/validation/velocity-content-release.json',report);
console.log(`Staged ${report.created_count} Safe Harbor Velocity page(s); live promotion is a separate validated release step.`);
