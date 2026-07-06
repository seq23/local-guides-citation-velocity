#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path'); const { forbiddenScaffoldMatches } = require('../lib/html_fix_rendering_contract'); const ROOT=path.resolve(__dirname,'../..');
function rel(p){return path.join(ROOT,p)} function readJson(p,f=null){try{return JSON.parse(fs.readFileSync(rel(p),'utf8'))}catch{return f}} function writeJson(p,v){const out=rel(p);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n')} function norm(v){return String(v||'').replace(/\s+/g,' ').trim().toLowerCase()}
function evidenceTokens(text){ const raw=String(text||''); const quoted=[...raw.matchAll(/['"“]([^'"”]{4,100})['"”]/g)].map(m=>m[1]); const directives=[...(raw.match(/(?:add|include|compare|define|explain)\s+[^.;|]+/gi)||[])]; return [...new Set([...quoted,...directives,raw].map(x=>String(x).replace(/\s+/g,' ').trim()).filter(x=>x.length>=8).slice(0,8))]; }
function targetTextFromPath(p){ if(!p) return ''; const candidates=[p, p.replace(/^\//,''), p.replace(/^\//,'').replace(/\/$/,'/index.html')]; for(const c of candidates){try{if(fs.existsSync(rel(c))) return fs.readFileSync(rel(c),'utf8')}catch{}} return ''; }
const semantic=readJson('data/report_fixes/agent_exact_semantic_acceptance_manifest.json',{entries:[]});
const ledger=readJson('data/report_fixes/agent_exact_implementation_ledger.json',{entries:[]});
const plan=readJson('artifacts/validation/agent-exact-implementation-plan.json',{specs:[]});
const activePlanPaths=new Set((plan.specs||[])
  .filter(spec=>spec.status!=='BLOCKED')
  .map(spec=>norm(spec.implementation_path||spec.intended_winner_path||''))
  .filter(Boolean));
const scopedLedgerEntries=activePlanPaths.size
  ? (ledger.entries||[]).filter(entry=>activePlanPaths.has(norm(entry.implementation_path)))
  : (ledger.entries||[]);
const checked=[]; const missing=[];
const skipped=[];
for(const entry of ledger.entries||[]){
  if(activePlanPaths.size && !activePlanPaths.has(norm(entry.implementation_path))){
    skipped.push({implementation_path:entry.implementation_path, reason:'outside_active_agent_exact_plan'});
  }
}
for(const entry of scopedLedgerEntries){
  if(entry.status==='BLOCKED') continue;
  const recs=entry.fix_recommendations||[];
  if(!recs.length) continue;
  const targetHtml=targetTextFromPath(entry.implementation_path);
  const targetText=norm(targetHtml);
  const semanticEntry=(semantic.entries||[]).find(e=>norm(e.implementation_path)===norm(entry.implementation_path));
  const semanticText=norm(JSON.stringify(semanticEntry||{}));
  const scaffoldErrors=forbiddenScaffoldMatches(targetHtml);
  if(scaffoldErrors.length) missing.push({implementation_path:entry.implementation_path, marker:entry.marker, recommendation:'rendered page contains scaffold placeholder text', tokens:scaffoldErrors});
  for(const rec of recs){
    const tokens=evidenceTokens(rec);
    const ok=tokens.some(tok=>targetText.includes(norm(tok))||semanticText.includes(norm(tok))) || (entry.record_ids||[]).some(id=>targetText.includes(norm(id))||semanticText.includes(norm(id)));
    checked.push({implementation_path:entry.implementation_path, marker:entry.marker, recommendation:rec, tokens:tokens.slice(0,4), ok});
    if(!ok) missing.push({implementation_path:entry.implementation_path, marker:entry.marker, recommendation:rec, tokens});
  }
}
const report={schema_version:'1.1',validator:'velocity-agent-recommendation-driven-output',status:missing.length?'FAIL':'PASS',scope:activePlanPaths.size?'active_agent_exact_plan':'cumulative_ledger',plan_specs:(plan.specs||[]).length,ledger_entries_total:(ledger.entries||[]).length,ledger_entries_considered:scopedLedgerEntries.length,ledger_entries_skipped:skipped.length,recommendations_checked:checked.length,missing_recommendation_evidence:missing,skipped,checked};
writeJson('artifacts/validation/velocity-agent-recommendation-driven-output.json',report);
if(missing.length){console.error(`VELOCITY RECOMMENDATION OUTPUT FAIL: ${missing.length} missing`);process.exit(1)}
console.log(`VELOCITY RECOMMENDATION OUTPUT PASS: ${checked.length} recommendations checked; scope=${report.scope}; considered=${scopedLedgerEntries.length}; skipped=${skipped.length}`);
