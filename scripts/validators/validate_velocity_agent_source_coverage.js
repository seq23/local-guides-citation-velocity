#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function rel(p){ return path.join(ROOT,p); }
function exists(p){ return fs.existsSync(rel(p)); }
function readJson(p,f=null){ try { return JSON.parse(fs.readFileSync(rel(p),'utf8')); } catch { return f; } }
function writeJson(p,v){ const out=rel(p); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out, JSON.stringify(v,null,2)+'\n'); }
function walk(dirRel, pred, out=[]){ const start=rel(dirRel); if(!fs.existsSync(start)) return out; for(const ent of fs.readdirSync(start,{withFileTypes:true})){ const p=path.join(dirRel,ent.name).replace(/\\/g,'/'); if(ent.isDirectory()) walk(p,pred,out); else if(!pred || pred(p)) out.push(p); } return out; }
function idsFrom(value){ return new Set((Array.isArray(value)?value:[value]).filter(Boolean).map(String)); }
const ledgers = walk('data/report_fixes/source_record_ledgers', p => p.endsWith('.json') && !p.endsWith('/latest.json')).map(p => ({ path:p, data: readJson(p,{records:[]}) }));
const normalizedFiles = walk('data/report_fixes/normalized_agent_runs', p => p.endsWith('.json'));
const normalized = normalizedFiles.flatMap(p => (readJson(p,{records:[]}).records || []).map(r => ({...r, normalized_path:p})));
const fixLedger = readJson('data/report_fixes/agent_fix_ledger.json',{fixes:[]});
const exactPlan = readJson('data/report_fixes/agent_exact_implementation_plan.json', readJson('artifacts/validation/agent-exact-implementation-plan.json',{specs:[]}));
const acceptance = readJson('data/report_fixes/agent_exact_semantic_acceptance_manifest.json',{entries:[]});
const htmlReport = readJson('data/report_fixes/html_report_contract.generated.json', readJson('artifacts/validation/html-report-contract.json',{}));
const approval = readJson('data/community/approval_queue.json', []);
const accounted = new Set();
const statuses = {};
function mark(id, status){ if(!id) return; accounted.add(String(id)); (statuses[id] ||= new Set()).add(status); }
for(const row of normalized){ for(const id of [...(row.source_record_ids || []), row.source_record_id].filter(Boolean)) mark(id, row.status || 'NORMALIZED'); }
for(const row of fixLedger.fixes || []){ for(const id of [...(row.source_record_ids || []), row.source_record_id].filter(Boolean)) mark(id, row.implementation_status || 'LEDGERED'); }
for(const spec of exactPlan.specs || []){ for(const id of [...(spec.source_record_ids || []), ...(spec.record_ids || []), spec.source_record_id, spec.record_id].filter(Boolean)) mark(id, spec.status || 'PLANNED'); }
for(const row of acceptance.entries || acceptance.repairs || []){ for(const id of [...(row.source_record_ids || []), ...(row.record_ids || []), row.source_record_id, row.record_id].filter(Boolean)) mark(id, row.status || 'ACCEPTED'); }
for(const row of [...(htmlReport.fixes || []), ...(htmlReport.page_specs || []), ...(htmlReport.approval_records_added || []), ...(htmlReport.approval_records_skipped || [])]){ for(const id of [...(row.source_record_ids || []), row.source_record_id].filter(Boolean)) mark(id, row.status || row.canonical_status || row.skipped_reason || 'HTML_REPORT_ACCOUNTED'); }
for(const row of Array.isArray(approval) ? approval : []){ for(const id of [...(row.source_record_ids || []), row.source_record_id].filter(Boolean)) mark(id, row.status || 'QUEUED_APPROVAL'); }
const sourceRecords = ledgers.flatMap(l => (l.data.records || []).map(r => ({...r, ledger_path:l.path})));
const missing = [];
const missingReason = [];
for(const r of sourceRecords){
  const id = r.source_record_id;
  if(!id) missing.push({ reason:'missing_source_record_id', ledger:r.ledger_path, query:r.query });
  else if(!accounted.has(id)) missing.push({ source_record_id:id, ledger:r.ledger_path, query:r.query, recommendation_type:r.recommendation_type, canonical_key:r.canonical_key });
}
for(const r of sourceRecords){
  const statusText = [...(statuses[r.source_record_id] || [])].join('|');
  if(/BLOCKED|SKIPPED/i.test(statusText) && !/reason|BLOCKED_|SKIPPED_|TARGET_NOT_FOUND|EXTERNAL|EXISTING|DUPLICATE/i.test(statusText)) missingReason.push({source_record_id:r.source_record_id,status:statusText});
}
const report = { schema_version:'1.0', validator:'velocity-agent-source-coverage', status: (ledgers.length && !missing.length && !missingReason.length) ? 'PASS' : 'FAIL', ledgers: ledgers.map(l=>l.path), source_records_found: sourceRecords.length, normalized_records: normalized.length, accounted_records: accounted.size, applied_records: [...accounted].filter(id => /APPLIED|ACCEPTED|LEDGERED/.test([...(statuses[id]||[])].join('|'))).length, built_records: [...accounted].filter(id => /BUILT|CREATE|PAGE/.test([...(statuses[id]||[])].join('|'))).length, queued_records: [...accounted].filter(id => /QUEUED|READY|PLANNED|FUTURE|APPROVED/.test([...(statuses[id]||[])].join('|'))).length, skipped_records: [...accounted].filter(id => /SKIPPED|EXISTING|DUPLICATE/.test([...(statuses[id]||[])].join('|'))).length, blocked_records: [...accounted].filter(id => /BLOCKED|EXTERNAL/.test([...(statuses[id]||[])].join('|'))).length, silent_drops: missing, missing_status: missing, missing_reason: missingReason, duplicate_groups: ledgers.flatMap(l => l.data.dedupe_groups || []), errors: [] };
if(!ledgers.length) report.errors.push('missing_source_record_ledgers');
writeJson('artifacts/validation/velocity-agent-source-coverage.json', report);
if(report.status !== 'PASS'){ console.error(`VELOCITY AGENT SOURCE COVERAGE FAIL: ledgers=${ledgers.length}; silent_drops=${missing.length}`); process.exit(1); }
console.log(`VELOCITY AGENT SOURCE COVERAGE PASS: ${sourceRecords.length} source records; accounted=${accounted.size}; silent_drops=0`);
