#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'../..');
const errors=[];const warnings=[];
function readJson(rel){return JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));}
function exists(rel){return fs.existsSync(path.join(ROOT,rel));}
const reportPath='artifacts/validation/html-report-contract.json';
if(!exists(reportPath)) errors.push('html_report_contract_artifact_missing');
let report=null;
if(!errors.length){
  try{report=readJson(reportPath);}catch(err){errors.push(`html_report_contract_invalid_json:${err.message}`);}
}
if(report){
  if(report.status!=='PASS') errors.push(`html_report_contract_status:${report.status}`);
  if(Number(report.manifests_seen||0)<1) errors.push('html_report_contract_no_manifests_seen');
  if(Number(report.pages_to_build_discovered||0)<1) errors.push('html_report_contract_no_pages_to_build_discovered');
  if(Number(report.fixes_discovered||0)<1) errors.push('html_report_contract_no_fixes_discovered');
  if(Number(report.blocked_fix_records||0)>0) warnings.push(`blocked_fix_records:${report.blocked_fix_records}`);
  const pageSpecs=Array.isArray(report.page_specs)?report.page_specs:[];
  const releasePageSpecs=Array.isArray(report.release_page_specs)?report.release_page_specs:[];
  if(releasePageSpecs.length>pageSpecs.length) errors.push(`release_page_specs_exceed_page_specs:${releasePageSpecs.length}>${pageSpecs.length}`);
  if(Number(report.pages_to_build_discovered||0)!==pageSpecs.length) errors.push(`page_specs_count_field_mismatch:${pageSpecs.length}!=${report.pages_to_build_discovered}`);
  if(Number(report.release_pages_to_build_discovered||0)!==releasePageSpecs.length) errors.push(`release_page_specs_count_field_mismatch:${releasePageSpecs.length}!=${report.release_pages_to_build_discovered}`);
  for(const spec of pageSpecs){
    if(!spec.query) errors.push(`page_spec_missing_query:${spec.id||'unknown'}`);
    if(spec.blocked_reason){
      warnings.push(`page_spec_blocked:${spec.id||spec.query}:${spec.blocked_reason}`);
    } else {
      if(!spec.target_route) errors.push(`page_spec_incomplete:${spec.id||spec.query||'unknown'}`);
      if(!/^\/[a-z0-9-]+\/(community-questions|guides|clusters)\/[a-z0-9-]+\/$/.test(String(spec.target_route||''))) errors.push(`page_spec_bad_route:${spec.target_route}`);
    }
  }
  const localApplied=(report.fixes||[]).filter(x=>x.status==='APPLIED').length;
  if(localApplied!==Number(report.fixes_applied||0)) errors.push(`fix_apply_count_mismatch:${localApplied}!=${report.fixes_applied}`);
}
const queue=exists('data/community/approval_queue.json')?readJson('data/community/approval_queue.json'):[];
const htmlQueue=(Array.isArray(queue)?queue:[]).filter(row=>row&&row.source==='html_report_contract');
if(report&&htmlQueue.length<Number(report.approval_queue_added||0)) errors.push(`approval_queue_missing_html_records:${htmlQueue.length}<${report.approval_queue_added}`);
const out={schema_version:'1.0',validator:'html-report-contract',status:errors.length?'FAIL':'PASS',errors,warnings,checked_at:process.env.SOURCE_DATE||new Date().toISOString().slice(0,10)};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/html-report-contract-validation.json'),JSON.stringify(out,null,2)+'\n');
if(errors.length){console.error('HTML REPORT CONTRACT VALIDATION FAIL');errors.forEach(e=>console.error(`- ${e}`));process.exit(1);}console.log(`HTML REPORT CONTRACT VALIDATION PASS: queued=${htmlQueue.length}`);
