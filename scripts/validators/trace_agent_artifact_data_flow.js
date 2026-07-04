#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const { parseManifestBundle } = require('../lib/agent_artifact_source_parser');
const RUN_ROOT = 'data/report_fixes/agent_runs';
const REPORT_PATH = 'artifacts/validation/agent-artifact-data-flow-trace.json';
function rel(p){ return path.join(ROOT, p); }
function exists(p){ return fs.existsSync(rel(p)); }
function readText(p){ return fs.readFileSync(rel(p), 'utf8'); }
function readJson(p, fb=null){ try { return JSON.parse(readText(p)); } catch { return fb; } }
function writeJson(p,v){ const out=rel(p); fs.mkdirSync(path.dirname(out), {recursive:true}); fs.writeFileSync(out, JSON.stringify(v,null,2)+'\n'); }
function walkFiles(dirRel, pred, out=[]){
  const start=rel(dirRel);
  if(!fs.existsSync(start)) return out;
  for(const ent of fs.readdirSync(start,{withFileTypes:true})){
    const p=path.join(dirRel, ent.name).replace(/\\/g,'/');
    if(ent.isDirectory()) walkFiles(p, pred, out);
    else if(!pred || pred(p)) out.push(p);
  }
  return out;
}
function walkManifests(){ const out=[]; const start=rel(RUN_ROOT); if(!fs.existsSync(start)) return out; function walk(abs){ for(const e of fs.readdirSync(abs,{withFileTypes:true})){ const p=path.join(abs,e.name); if(e.isDirectory()) walk(p); else if(e.name==='agent_run_manifest.json') out.push(path.relative(ROOT,p).replace(/\\/g,'/')); } } walk(start); return out.sort(); }
function parseCsvRows(text){ const rows=[]; let row=[], field='', q=false; for(let i=0;i<text.length;i++){ const ch=text[i], next=text[i+1]; if(ch==='"'){ if(q&&next==='"'){ field+='"'; i++; } else q=!q; } else if(ch===','&&!q){ row.push(field); field=''; } else if((ch==='\n'||ch==='\r')&&!q){ if(ch==='\r'&&next==='\n') i++; row.push(field); field=''; if(row.some(c=>String(c).trim())) rows.push(row); row=[]; } else field+=ch; } if(field.length||row.length){ row.push(field); if(row.some(c=>String(c).trim())) rows.push(row); } if(!rows.length) return []; const headers=rows.shift().map(h=>String(h||'').replace(/^\uFEFF/,'').trim()); return rows.map(cells=>Object.fromEntries(headers.map((h,i)=>[h,String(cells[i]||'').trim()]))); }
function normalizeRoute(route){ let v=String(route||'').trim(); if(!v) return ''; v=v.replace(/^https?:\/\/[^/]+/,''); if(!v.startsWith('/')) v=`/${v}`; return v.replace(/\/+/g,'/'); }
function routeToPath(route){ let v=normalizeRoute(route).replace(/^\//,''); if(!v) return ''; if(v.endsWith('.html')) return v; return `${v.replace(/\/+$/,'')}/index.html`; }
function pageExists(payload, route){ const wanted=normalizeRoute(route); const wantedPath=routeToPath(route); return (payload.pages||[]).some(p=>normalizeRoute(p.slug||p.path||'')===wanted || routeToPath(p.path||p.slug||'')===wantedPath); }
function renderedExistsForExistingRoute(existingRoute){
  const raw=String(existingRoute||'').trim();
  if(!raw) return false;
  const candidates=[];
  if(raw.startsWith('/')) candidates.push(routeToPath(raw));
  else if(raw.endsWith('.html')) candidates.push(raw.replace(/^\/+/,''));
  else if(raw.includes('/')) candidates.push(routeToPath(raw));
  else candidates.push(`insights/${raw}.html`);
  return candidates.some(candidate=>candidate&&exists(candidate));
}
function jsonFixRows(payload){ const rows=[]; for(const key of ['free_wins','outperform','page_fixes']) for(const row of Array.isArray(payload[key])?payload[key]:[]) rows.push({...row, source_category:key}); return rows; }
function uniqueFixKey(row){ return [row.file_path||row.page_url||'', row.query||'', row.fix||row.fix_recommendation||''].map(String).join('|'); }
const errors=[]; const warnings=[]; const traces=[];
const manifests=walkManifests().map(p=>({path:p, manifest:readJson(p,null)})).filter(x=>x.manifest&&x.manifest.json_path);
const sourceLedgerFiles=walkFiles('data/report_fixes/source_record_ledgers', p => p.endsWith('.json') && !p.endsWith('/latest.json'));
const sourceRecords=sourceLedgerFiles.flatMap(p => {
  const ledger=readJson(p,{records:[]});
  return (ledger.records||[]).map(r=>({...r, ledger_path:p}));
});
const parsedManifestSourceRecords=manifests.flatMap(({path:manifestPath}) => parseManifestBundle({manifestPath, root:ROOT}).records || []);
const sourceRecordsForTrace=sourceRecords.length ? sourceRecords : parsedManifestSourceRecords;
const htmlReport=readJson('artifacts/validation/html-report-contract.json', {});
const intake=readJson('artifacts/validation/agent-run-intake.json', {});
const releasePlan=readJson('artifacts/validation/velocity-intake-release-plan.json', {});
const exactPlan=readJson('artifacts/validation/agent-exact-implementation-plan.json', {});
const exactTrace=readJson('artifacts/validation/agent-exact-implementation-trace.json', {});
const exactValidate=readJson('artifacts/validation/agent-exact-implementation.json', {});
const velocityRelease=readJson('artifacts/validation/velocity-content-release.json', {});
const livePages=readJson('content/_live/pages.json', {pages:[]});
const stagedPages=readJson('content/_staged/pages.json', {pages:[]});
if(!manifests.length) warnings.push('no_json_agent_manifests_present');
for(const {path:manifestPath, manifest} of manifests){
  const trace={manifest_path:manifestPath, run_date:manifest.run_date, vertical:manifest.vertical, status:manifest.status, csv_path:manifest.csv_path, html_path:manifest.html_path, json_path:manifest.json_path, errors:[], warnings:[]};
  for(const key of ['csv_path','html_path','json_path']) if(!exists(manifest[key]||'')) trace.errors.push(`missing_${key}:${manifest[key]||''}`);
  const csvRows=exists(manifest.csv_path)?parseCsvRows(readText(manifest.csv_path)):[];
  const json=exists(manifest.json_path)?readJson(manifest.json_path, {}):{};
  const jsonFixes=jsonFixRows(json);
  const uniqueFixes=[...new Set(jsonFixes.map(uniqueFixKey))];
  const pagesToBuild=Array.isArray(json.pages_to_build)?json.pages_to_build:[];
  trace.csv_row_count=csvRows.length;
  trace.json_scoreboard_total=Number((json.scoreboard||{}).total||0);
  trace.json_fix_rows=jsonFixes.length;
  trace.json_unique_fix_rows=uniqueFixes.length;
  trace.json_pages_to_build=pagesToBuild.length;
  if(trace.json_scoreboard_total && trace.csv_row_count!==trace.json_scoreboard_total) trace.errors.push(`csv_json_scoreboard_mismatch:${trace.csv_row_count}!=${trace.json_scoreboard_total}`);
  if(trace.csv_row_count<1) trace.errors.push('csv_empty');
  if(trace.json_fix_rows<1) trace.errors.push('json_fix_rows_empty');
  if(trace.json_pages_to_build<1) trace.errors.push('json_pages_to_build_empty');
  const normalizedPath=manifest.normalized_path || `data/report_fixes/normalized_agent_runs/${manifest.run_date}_${String(manifest.vertical||'').replace(/-/g,'_')}.json`;
  const normalized=readJson(normalizedPath, null);
  trace.normalized_path=normalizedPath;
  trace.normalized_exists=Boolean(normalized);
  trace.normalized_record_count=normalized ? Number(normalized.record_count||((normalized.records||[]).length)) : 0;
  if(!normalized) trace.errors.push(`normalized_missing:${normalizedPath}`);
  else if(trace.normalized_record_count<1) trace.errors.push(`normalized_empty:${normalizedPath}`);
  else if(trace.normalized_record_count!==trace.csv_row_count) trace.warnings.push(`normalized_csv_count_diff_trace_only:${trace.normalized_record_count}!=${trace.csv_row_count}`);
  const summary=(htmlReport.report_summaries||[]).find(s=>s.manifest_path===manifestPath);
  trace.html_report_parser=summary ? summary.parser || 'html' : '';
  trace.html_report_fix_count=summary ? Number(summary.new_fix_count||0) : 0;
  trace.html_report_pages_to_build=summary ? Number(summary.page_to_build_count||0) : 0;
  if(summary && summary.parser!=='json') trace.errors.push(`html_report_parser_not_json:${summary.parser||'html'}`);
  if(summary && trace.html_report_pages_to_build!==trace.json_pages_to_build) trace.errors.push(`pages_to_build_parser_mismatch:${trace.html_report_pages_to_build}!=${trace.json_pages_to_build}`);
  const pageSpecs=(htmlReport.page_specs||[]).filter(p=>p.manifest_path===manifestPath);
  const skipped=(htmlReport.approval_records_skipped||[]).filter(p=>p.id && pageSpecs.some(s=>s.id===p.id));
  const added=(htmlReport.approval_records_added||[]).filter(p=>p.id && pageSpecs.some(s=>s.id===p.id));
  trace.page_specs_count=pageSpecs.length;
  trace.approval_records_added=added.length;
  trace.approval_records_skipped=skipped.length;
  if(pageSpecs.length!==trace.json_pages_to_build) trace.errors.push(`page_specs_count_mismatch:${pageSpecs.length}!=${trace.json_pages_to_build}`);
  if(added.length+skipped.length!==pageSpecs.length) trace.errors.push(`page_spec_accounting_mismatch:${added.length}+${skipped.length}!=${pageSpecs.length}`);
  const addedRoutesMissing=[];
  const allPageSpecRoutesMissing=[];
  const skippedById=new Map(skipped.map(rec=>[rec.id, rec]));
  let resolvedByExistingRoute=0;
  for(const spec of pageSpecs){
    const route=spec.target_route;
    const rendered=routeToPath(route);
    const inLive=pageExists(livePages, route);
    const inStaged=pageExists(stagedPages, route);
    const renderedExists=rendered && exists(rendered);
    const skip=skippedById.get(spec.id);
    const existingResolved=skip && skip.skipped_reason==='exact_title_already_exists' && renderedExistsForExistingRoute(skip.existing_route);
    if(existingResolved) resolvedByExistingRoute++;
    if(!existingResolved && (!inLive || !inStaged || !renderedExists)) allPageSpecRoutesMissing.push({route, live:inLive, staged:inStaged, rendered:renderedExists, skipped_reason:skip&&skip.skipped_reason||'', existing_route:skip&&skip.existing_route||''});
  }
  for(const rec of added){
    const inLive=pageExists(livePages, rec.target_route);
    const inStaged=pageExists(stagedPages, rec.target_route);
    const rendered=routeToPath(rec.target_route);
    const renderedExists=rendered && exists(rendered);
    if(!inLive || !inStaged || !renderedExists) addedRoutesMissing.push({route:rec.target_route, live:inLive, staged:inStaged, rendered:renderedExists});
  }
  trace.page_spec_routes_rendered=pageSpecs.length-allPageSpecRoutesMissing.length;
  trace.page_spec_routes_resolved_by_existing=resolvedByExistingRoute;
  trace.added_routes_rendered=added.length-addedRoutesMissing.length;
  if(allPageSpecRoutesMissing.length) trace.errors.push(`page_spec_routes_missing:${JSON.stringify(allPageSpecRoutesMissing.slice(0,5))}`);
  if(addedRoutesMissing.length) trace.errors.push(`added_routes_missing:${JSON.stringify(addedRoutesMissing.slice(0,5))}`);
  traces.push(trace);
  for(const e of trace.errors) errors.push(`${manifestPath}:${e}`);
  for(const w of trace.warnings) warnings.push(`${manifestPath}:${w}`);
}
if(htmlReport.status && htmlReport.status!=='PASS') errors.push(`html_report_status:${htmlReport.status}`);
if(intake.status && intake.status!=='PASS') errors.push(`agent_intake_status:${intake.status}`);
if(releasePlan.status && releasePlan.status!=='PASS') errors.push(`velocity_release_plan_status:${releasePlan.status}`);
if(exactPlan.status && exactPlan.status!=='PASS') errors.push(`agent_exact_plan_status:${exactPlan.status}`);
if(exactTrace.status && exactTrace.status!=='PASS') errors.push(`agent_exact_trace_status:${exactTrace.status}`);
if(exactValidate.status && exactValidate.status!=='PASS') errors.push(`agent_exact_validate_status:${exactValidate.status}`);
const exactLedger=readJson('data/report_fixes/agent_exact_implementation_ledger.json', {entries:[]});
for(const trace of traces){
  const normalized=readJson(trace.normalized_path, {records:[]});
  const repairRows=(normalized.records||[]).filter(row=>row.operation==='REPAIR_INTENDED_WINNER_PAGE' && row.intended_winner_path);
  const currentRepairRows=repairRows.filter(row=>row.source==='twin_agent_artifact');
  const currentRepairIds=new Set(currentRepairRows.map(row=>row.id));
  const ledgerIds=new Set((exactLedger.entries||[]).flatMap(entry=>entry.record_ids||[]));
  const missing=[...currentRepairIds].filter(id=>!ledgerIds.has(id));
  trace.exact_repair_rows=repairRows.length;
  trace.exact_repair_rows_ledgered=repairRows.length-missing.length;
  if(missing.length) errors.push(`${trace.manifest_path}:exact_repair_rows_missing_from_ledger:${missing.slice(0,10).join(',')}`);
}
const report={schema_version:'1.0',validator:'agent-artifact-data-flow-trace',status:errors.length?'FAIL':'PASS',manifest_count:manifests.length,traces,workflow:{agent_intake_status:intake.status||'',html_report_status:htmlReport.status||'',velocity_plan_selected_count:releasePlan.selected_count||0,velocity_created_count:velocityRelease.created_count||0,exact_plan_repairs:exactPlan.repair_count||0,exact_plan_new_pages:exactPlan.new_page_count||0,exact_trace_status:exactTrace.status||'',exact_validate_status:exactValidate.status||''},errors,
  source_records_found: sourceRecordsForTrace.length,
  source_records_by_file: sourceRecordsForTrace.reduce((acc, r) => { acc[r.source_file] = (acc[r.source_file] || 0) + 1; return acc; }, {}),
  source_records_by_section: sourceRecordsForTrace.reduce((acc, r) => { acc[r.source_section] = (acc[r.source_section] || 0) + 1; return acc; }, {}),
  source_recommendations_with_nested_objects: sourceRecordsForTrace.filter((r) => r.recommendation_fields && Object.keys(r.recommendation_fields).length > 1).length,
  new_page_opportunity_records: sourceRecordsForTrace.filter((r) => r.recommendation_type === 'new_page_opportunity').length,
  existing_page_fix_records: sourceRecordsForTrace.filter((r) => r.recommendation_type === 'existing_page_fix').length,
  source_record_trace_origin: sourceRecords.length ? 'source_record_ledgers' : 'parsed_agent_manifests',
  source_record_ledger_count: sourceLedgerFiles.length,
  parsed_manifest_source_record_count: parsedManifestSourceRecords.length,
  coverage_validator_status: fs.existsSync(path.join(ROOT, 'artifacts/validation/velocity-agent-source-coverage.json')) ? (JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/validation/velocity-agent-source-coverage.json'), 'utf8')).status || 'UNKNOWN') : 'NOT_RUN',warnings,checked_at:process.env.SOURCE_DATE||new Date().toISOString().slice(0,10)};
writeJson(REPORT_PATH, report);
if(errors.length){ console.error('AGENT ARTIFACT DATA FLOW TRACE FAIL'); errors.forEach(e=>console.error(`- ${e}`)); process.exit(1); }
console.log(`AGENT ARTIFACT DATA FLOW TRACE PASS: ${manifests.length} json manifest(s)`);
