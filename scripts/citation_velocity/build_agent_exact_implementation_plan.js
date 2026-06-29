#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const POLICY_PATH = 'data/report_fixes/agent_exact_implementation_policy.json';
function rel(p){ return path.join(ROOT,p); }
function readJson(p, f=null){ try { return JSON.parse(fs.readFileSync(rel(p),'utf8')); } catch { return f; } }
function writeJson(p, v){ const out=rel(p); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out, JSON.stringify(v,null,2)+'\n'); }
function fileHash(p){ return fs.existsSync(rel(p)) ? crypto.createHash('sha256').update(fs.readFileSync(rel(p))).digest('hex') : null; }
function collectNormalizedRecords(){
  const dir=rel('data/report_fixes/normalized_agent_runs');
  const out=[];
  if(!fs.existsSync(dir)) return out;
  for(const name of fs.readdirSync(dir).sort()){
    if(!name.endsWith('.json')) continue;
    const p=`data/report_fixes/normalized_agent_runs/${name}`;
    const payload=readJson(p,{records:[]});
    for(const row of payload.records||[]) out.push({...row, normalized_path:p});
  }
  return out;
}
function latestReleasePlan(){ return readJson('artifacts/validation/velocity-intake-release-plan.json',{selected_ids:[], selected_units:[]}); }
function main(){
  const policy=readJson(POLICY_PATH,{effective_from:'9999-12-31'});
  const release=latestReleasePlan();
  const selectedIds=new Set(release.selected_ids||[]);
  const allRows=collectNormalizedRecords().filter(row=>row.source==='twin_agent_artifact');
  const selectedRows=allRows.filter(row=>selectedIds.has(row.id));
  const blockedRows=allRows.filter(row=>String(row.status||'').startsWith('BLOCKED_') || String(row.operation||'').startsWith('BLOCKED_'));
  const selectedRepairTargets=new Set(selectedRows
    .filter(row=>row.operation==='REPAIR_INTENDED_WINNER_PAGE' && row.intended_winner_path)
    .map(row=>row.intended_winner_path));
  const siblingRepairRows=allRows.filter(row=>
    row.operation==='REPAIR_INTENDED_WINNER_PAGE'
    && row.intended_winner_path
    && selectedRepairTargets.has(row.intended_winner_path)
  );
  const rows=[];
  const rowIds=new Set();
  for(const row of [...selectedRows, ...siblingRepairRows, ...blockedRows]){
    if(rowIds.has(row.id)) continue;
    rowIds.add(row.id);
    rows.push(row);
  }
  const specs=[];
  const groupedRepairs=new Map();
  for(const row of rows){
    if(policy.retroactive_processing===false && row.run_date && policy.effective_from && row.run_date < policy.effective_from) continue;
    if(String(row.status||'').startsWith('BLOCKED_')){
      specs.push({record_id:row.id, run_date:row.run_date, query:row.query, operation:row.operation||row.status, intended_winner_page:row.intended_winner_page||'', intended_winner_path:row.intended_winner_path||'', target_route:row.target_route||'', status:'BLOCKED', blocked_reason:row.blocked_reason||row.status});
      continue;
    }
    if(row.operation==='REPAIR_INTENDED_WINNER_PAGE'){
      const key=row.intended_winner_path;
      const current=groupedRepairs.get(key)||{record_ids:[], queries:[], recommendations:[], row};
      current.record_ids.push(row.id);
      if(row.query) current.queries.push(row.query);
      if(row.recommendation) current.recommendations.push(row.recommendation);
      groupedRepairs.set(key,current);
    } else if(row.operation==='CREATE_NEW_TARGET_PAGE'){
      const targetPath=String(row.target_route||'').replace(/^\//,'').replace(/\/$/,'/index.html');
      specs.push({record_id:row.id, run_date:row.run_date, query:row.query, intended_winner_page:row.intended_winner_page||'', intended_winner_path:row.intended_winner_path||'', target_route:row.target_route||'', implementation_path:targetPath, operation:'CREATE_NEW_TARGET_PAGE', before_hash:fileHash(targetPath), after_hash:null, status:'PLANNED', blocked_reason:''});
    }
  }
  for(const [implementationPath, group] of groupedRepairs){
    const row=group.row;
    specs.push({record_id:group.record_ids[0], record_ids:group.record_ids, run_date:row.run_date, query:group.queries[0], queries:[...new Set(group.queries)], intended_winner_page:row.intended_winner_page||'', intended_winner_path:implementationPath, target_route:row.target_route||'', implementation_path:implementationPath, supporting_route:row.supporting_route||'', operation:'REPAIR_INTENDED_WINNER_PAGE', before_hash:fileHash(implementationPath), after_hash:null, status:'PLANNED', blocked_reason:'', fix_recommendations:[...new Set(group.recommendations)]});
  }
  const report={schema_version:'1.1', status:'PASS', generated_at:DATE, policy_path:POLICY_PATH, release_plan:'artifacts/validation/velocity-intake-release-plan.json', selected_agent_rows:selectedRows.length, considered_agent_rows:rows.length, selected_repair_targets:selectedRepairTargets.size, blocked_agent_rows_carried:specs.filter(x=>x.status==='BLOCKED').length, repair_count:specs.filter(x=>x.operation==='REPAIR_INTENDED_WINNER_PAGE').length, new_page_count:specs.filter(x=>x.operation==='CREATE_NEW_TARGET_PAGE').length, blocked_count:specs.filter(x=>x.status==='BLOCKED').length, specs:specs.sort((a,b)=>String(a.implementation_path||a.target_route).localeCompare(String(b.implementation_path||b.target_route)))};
  writeJson('artifacts/validation/agent-exact-implementation-plan.json', report);
  writeJson('data/report_fixes/agent_exact_implementation_plan.json', report);
  console.log(`AGENT EXACT IMPLEMENTATION PLAN PASS: repairs=${report.repair_count}; new_pages=${report.new_page_count}; blocked=${report.blocked_count}`);
}
main();
