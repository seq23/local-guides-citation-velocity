#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'../..');const errors=[];const warnings=[];
function readJson(rel,fb=null){const p=path.join(ROOT,rel);if(!fs.existsSync(p))return fb;return JSON.parse(fs.readFileSync(p,'utf8'));}
function read(rel){const p=path.join(ROOT,rel);return fs.existsSync(p)?fs.readFileSync(p,'utf8'):'';}
function exists(rel){return fs.existsSync(path.join(ROOT,rel));}
function pagesBySlug(rel){const payload=readJson(rel,{pages:[]});return new Map((payload.pages||[]).map(p=>[p.slug,p]));}
const ledger=readJson('data/report_fixes/agent_fix_ledger.json',{fixes:[]});
if(exists('data/report_fixes/velocity_citation_agent_2026_05.json')) warnings.push('historical_may_2026_ledger_present; retired legacy trace is preserved but not blocking the rolling agent-run lane');
const selected=(ledger.fixes||[]).filter(f=>f.trace_required||f.implementation_status==='SELECTED_FOR_RELEASE');
const livePages=pagesBySlug('content/_live/pages.json');
const stagedPages=pagesBySlug('content/_staged/pages.json');
for(const fix of selected){const id=fix.id||fix.query;const markers=Array.from(new Set(fix.required_markers||[fix.query].filter(Boolean)));if(!markers.length){errors.push(`${id}:missing_required_markers`);continue;}
 for(const [label,map] of [['staged',stagedPages],['live',livePages]]){const route=fix.target_route||('/'+String(fix.renderedPath||'').replace(/index\.html$/,''));const page=map.get(route);if(!page){errors.push(`${id}:${label}_missing_route:${route}`);continue;}const haystack=JSON.stringify(page);for(const m of markers)if(!haystack.includes(m))errors.push(`${id}:${label}_missing_marker:${m}`);}
 if(fix.renderedPath){if(!exists(fix.renderedPath))warnings.push(`${id}:rendered_path_not_present_yet:${fix.renderedPath}`);else{const text=read(fix.renderedPath);for(const m of markers)if(!text.includes(m))errors.push(`${id}:rendered_missing_marker:${fix.renderedPath}:${m}`);}}
}
const plan=readJson('artifacts/validation/velocity-intake-release-plan.json',null);
if(plan&&plan.selected_count>0){for(const unit of plan.selected_units||[]){const live=livePages.get(unit.target_route);const staged=stagedPages.get(unit.target_route);if(!live)errors.push(`${unit.id}:live_missing_route:${unit.target_route}`);else if(String(live.title||live.description||JSON.stringify(live)).indexOf(unit.query)===-1)errors.push(`${unit.id}:live_missing_query`);if(!staged)errors.push(`${unit.id}:staged_missing_route:${unit.target_route}`);else if(String(staged.title||staged.description||JSON.stringify(staged)).indexOf(unit.query)===-1)errors.push(`${unit.id}:staged_missing_query`);}}
if(!plan)warnings.push('velocity_intake_release_plan_missing; no current intake release to trace');
const report={schema_version:'1.0',validator:'citation-agent-fix-trace',status:errors.length?'FAIL':'PASS',selected_trace_count:selected.length,release_plan_count:plan&&plan.selected_count||0,errors,warnings,checked_at:process.env.SOURCE_DATE||new Date().toISOString().slice(0,10)};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/citation-agent-fix-trace.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error('CITATION AGENT FIX TRACE FAIL');errors.forEach(e=>console.error(`- ${e}`));process.exit(1);}console.log(`CITATION AGENT FIX TRACE PASS: ${selected.length} selected fix(es), ${report.release_plan_count} release unit(s).`);
