#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const read = (rel, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8')); } catch { return fallback; } };
const write = (rel, value) => { const abs=path.join(ROOT,rel); fs.mkdirSync(path.dirname(abs),{recursive:true}); fs.writeFileSync(abs,JSON.stringify(value,null,2)+'\n'); };
const norm = (s) => String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
const { containsModelName, modelNamesIn } = require('../lib/model_name_guard');
const strategy = read('data/strategy/page_strategy_registry.json', {});
const approvals = read('data/community/approval_queue.json', []);
// Second intake lane: measured query demand.
//
// Until now every record here carried source="twin_agent_artifact", so the only
// way a page could be proposed was a human pushing an agent-run manifest - five
// runs and eight pages since June - while the measured query atlas sat unread.
// Candidates from scripts/queries/join_atlas_to_release_queue.mjs enter through
// this same function and face every gate below unchanged. The join proposes; the
// release law still decides.
const measured = read('data/queries/measured_demand_candidates.json', {candidates: []});

// Third intake lane: the declared unbuilt backlog. THIS IS THE DRAIN.
//
// data/content/unbuilt_rich_page_backlog.json declares every route that was
// discovered, classified, marked READY_TO_RELEASE and admitted for build in
// artifacts/validation/html-report-contract.json and then never built - the
// oldest since 2026-06-23. Declaring it stopped it growing. Nothing drained it:
// this file only ever read the approval queue and the measured atlas, so an
// admitted row that reached the backlog had no path back out. A queue with no
// consumer is the same defect as demand that produces nothing, wearing the
// paperwork of a decision.
//
// The backlog now feeds this queue like any other intake. It proposes; the
// release law below still decides, unchanged - a backlog row faces the same
// vertical, route-shape, duplicate, topic-fit, source-record and neutrality
// gates as a human-approved row, and is skipped and recorded if it fails one.
// The governed 2-new-URLs/day ceiling in scripts/velocity_content_release.js is
// untouched: the drain rate is whatever policy already allows, and no faster.
//
// Order is oldest-first by the date the route was first admitted, so the wait
// is served in the order it was incurred. Entries dispositioned RETIRED are not
// build candidates - they carry a retirement reason instead and stay declared
// so the decision is auditable.
const BACKLOG_REL = 'data/content/unbuilt_rich_page_backlog.json';
const backlogDoc = read(BACKLOG_REL, {routes: []});
const htmlContract = read('artifacts/validation/html-report-contract.json', {page_specs: []});
const specByRoute = new Map();
for (const spec of (htmlContract.page_specs || [])) {
  if (spec && spec.target_route && !specByRoute.has(spec.target_route)) specByRoute.set(spec.target_route, spec);
}
const backlogIntake = (Array.isArray(backlogDoc.routes) ? backlogDoc.routes : [])
  .filter((entry) => entry && entry.route && String(entry.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE')
  .sort((a, b) => String(a.first_admitted_on || '').localeCompare(String(b.first_admitted_on || '')) || String(a.route).localeCompare(String(b.route)))
  .map((entry) => {
    const spec = specByRoute.get(entry.route);
    if (!spec) return null;
    return {
      ...spec,
      id: spec.id || `backlog_${entry.route}`,
      source: 'unbuilt_rich_page_backlog',
      source_run_id: `backlog:first_admitted:${entry.first_admitted_on}`,
      operation: 'CREATE_NEW_TARGET_PAGE',
      status: 'APPROVED',
      // The specs carry evidence ids under source_record_ids; the release law
      // reads source_records. Same evidence, two field names, so it is mapped
      // here rather than weakening require_source_records.
      source_records: (spec.source_records && spec.source_records.length) ? spec.source_records : (spec.source_record_ids || []),
      backlog_first_admitted_on: entry.first_admitted_on,
    };
  })
  .filter(Boolean);

const intake = [
  ...(Array.isArray(approvals) ? approvals : []),
  ...(Array.isArray(measured.candidates) ? measured.candidates : []),
  ...backlogIntake,
];
const admission = read('data/content/page_admission_registry.json', {pages:[]});
const live = read('content/_live/pages.json', {pages:[]});
const admittedRoutes = new Set((admission.pages||[]).map((p)=>p.path));
const existingTitles = new Set((live.pages||[]).map((p)=>norm(p.title||p.visible_q||'')).filter(Boolean));

function verticalConfig(item) { return strategy.allowed_verticals?.[item.vertical] || strategy.allowed_verticals?.[String(item.vertical||'').replace('_','-')] || null; }
function decide(item) {
  const op = String(item.operation||'').toUpperCase();
  if (op === 'REPAIR_INTENDED_WINNER_PAGE') return {decision:'REPAIR_EXISTING', eligible:false, reasons:['repair_lane_owned_by_agent_exact']};
  if (op !== 'CREATE_NEW_TARGET_PAGE') return {decision:'SKIP_UNSUPPORTED', eligible:false, reasons:['unsupported_operation']};
  if (!['APPROVED','READY_TO_PUBLISH'].includes(String(item.status||'').toUpperCase())) return {decision:'SKIP_UNSUPPORTED',eligible:false,reasons:['intake_not_eligible']};
  const reasons=[];
  const cfg=verticalConfig(item);
  const route=String(item.target_route||'');
  const query=String(item.query||item.normalized_query||'').trim();
  // A route or a question that names the model that generated it never reaches
  // a build. Seven such routes were published before this gate existed and were
  // retired on 2026-08-29; scripts/lib/page_family_router.js now strips the name
  // before a route is minted, and this refuses anything that arrives already
  // carrying one - a pre-computed target_route from an artifact, for instance,
  // which the router never sees.
  if (containsModelName(route) || containsModelName(query)) {
    return {decision:'SKIP_PROHIBITED',eligible:false,reasons:[`model_name_in_route_or_query:${modelNamesIn(`${route} ${query}`).join(', ')}`]};
  }
  const lower=norm(query);
  if (!cfg) reasons.push('unsupported_vertical');
  if (!route || !route.startsWith('/')) reasons.push('missing_or_invalid_target_route');
  if (cfg && !cfg.route_prefixes.some((prefix)=>route.startsWith(prefix))) reasons.push('route_outside_vertical');
  if (!(strategy.allowed_route_families||[]).includes(item.route_family)) reasons.push('unsupported_route_family');
  if (query.length < Number(strategy.new_page_gate?.minimum_query_characters||20)) reasons.push('query_too_short');
  if (admittedRoutes.has(route)) return {decision:'SKIP_DUPLICATE',eligible:false,reasons:['route_already_admitted']};
  if (existingTitles.has(lower)) return {decision:'SKIP_DUPLICATE',eligible:false,reasons:['equivalent_title_exists']};
  const sourceRecords=(item.source_records||[]).filter(Boolean);
  if (strategy.new_page_gate?.require_source_records && !sourceRecords.length) reasons.push('missing_source_records');
  if (cfg && strategy.new_page_gate?.require_topic_fit && !(cfg.topic_terms||[]).some((term)=>lower.includes(term))) reasons.push('vertical_topic_fit_failed');
  const canonical=cfg?.canonical;
  for (const phrase of strategy.vertical_exclusions?.[canonical]||[]) if (lower.includes(phrase)) reasons.push(`off_topic:${phrase}`);
  for (const raw of strategy.new_page_gate?.forbidden_patterns||[]) if (new RegExp(raw,'i').test(query)) reasons.push(`prohibited_language:${raw}`);
  if (reasons.some((r)=>r.startsWith('off_topic:'))) return {decision:'SKIP_OFF_TOPIC',eligible:false,reasons};
  if (reasons.some((r)=>r.startsWith('prohibited_language:'))) return {decision:'SKIP_PROHIBITED',eligible:false,reasons};
  if (reasons.length) return {decision:'SKIP_UNSUPPORTED',eligible:false,reasons};
  return {decision:'SAFE_AUTOPUBLISH',eligible:true,reasons:['distinct_route','topic_fit','source_records_present','allowed_family','neutrality_gate_passed']};
}

const records=(Array.isArray(intake)?intake:[]).map((item)=>({
  id:item.id,
  source:item.source,
  source_run_id:item.source_run_id,
  operation:item.operation,
  vertical:item.vertical,
  query:item.query,
  normalized_query:item.normalized_query,
  target_route:item.target_route,
  renderedPath:item.renderedPath,
  route_family:item.route_family,
  route_shape:item.route_shape,
  admission_basis:item.admission_basis,
  source_records:item.source_records||[],
  source_record_ids:item.source_record_ids||[],
  source_artifacts:item.source_artifacts||{},
  original_status:item.status,
  ...decide(item),
  lifecycle_state: decide(item).eligible ? 'ADMITTED_FOR_BUILD' : 'NOT_ADMITTED',
  evaluated_at:`${DATE}T00:00:00.000Z`
}));
const eligible=records.filter((r)=>r.eligible);
const payload={
  schema_version:'1.0', authority:'data/strategy/page_strategy_registry.json', generated_at:`${DATE}T00:00:00.000Z`,
  runtime_autonomy:'FULL_SAFE_AUTONOMY', policy:'safe work auto-proceeds; unsupported/duplicate/off-topic/prohibited work skips, records, and continues',
  input_count:records.length, eligible_count:eligible.length, records
};
write('data/release/page_release_queue.json',payload);
write('artifacts/validation/page-release-queue.json',{status:'PASS',input_count:records.length,eligible_count:eligible.length,decisions:records.reduce((m,r)=>(m[r.decision]=(m[r.decision]||0)+1,m),{})});
console.log(`PAGE RELEASE QUEUE PASS: input=${records.length}; safe_autopublish=${eligible.length}`);
