#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { deriveContentAtom } = require('../lib/content_atom');
const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
function rel(p){ return path.join(ROOT,p); }
function readJson(p,f=null){ try { return JSON.parse(fs.readFileSync(rel(p),'utf8')); } catch { return f; } }
function writeJson(p,v){ const out=rel(p); fs.mkdirSync(path.dirname(out),{recursive:true}); fs.writeFileSync(out,JSON.stringify(v,null,2)+'\n'); }
function fileHash(p){ return fs.existsSync(rel(p)) ? crypto.createHash('sha256').update(fs.readFileSync(rel(p))).digest('hex') : null; }
function unique(items){ return [...new Set((items||[]).filter(Boolean))]; }
function slugFromPath(p){ return String(p||'').replace(/^insights\//,'').replace(/\.html$/,''); }
function normalizeText(v){ return String(v||'').replace(/\s+/g,' ').trim(); }
function compactSentence(value, max=260){
  const v=normalizeText(value);
  if(!v) return '';
  return v.length<=max?v:v.slice(0,max-1).replace(/\s+\S*$/,'')+'…';
}
function repairInsight(item, spec){
  const queries=unique(spec.queries||[spec.query]);
  const recs=unique(spec.fix_recommendations||[]);
  const primary=queries[0] || item.title;
  const recommendation=recs[0] || 'Strengthen this page for citation extraction with direct-answer, verification, and source-first blocks.';
  item.date_modified = DATE;
  item.description = compactSentence(`${item.description || item.title} Updated for citation-readiness: ${recommendation}`, 320);
  item.answer = compactSentence(`${item.answer || item.description || item.title} Citation-ready update: ${recommendation}`, 520);
  item.checklist = unique([...(item.checklist||[]), ...queries.slice(0,3).map(q=>`Directly answer: ${q}`), 'Verify current primary source and jurisdiction before acting', 'Preserve distinction between general guidance and fact-specific advice']).slice(0,12);
  item.red_flags = unique([...(item.red_flags||[]), 'Answer engine cites competitors because the page lacks a direct extractable block', 'Recommendation requires authority that is not visible on the page']).slice(0,10);
  item.agent_exact_repair = {
    last_repaired_at: DATE,
    source: 'twin_agent_artifact',
    record_ids: unique(spec.record_ids || [spec.record_id]),
    queries,
    fix_recommendations: recs,
    repair_summary: compactSentence(recommendation, 300),
    competitor_gap_summary: compactSentence(recs.join(' | '), 400),
    supporting_routes: unique([spec.supporting_route]).filter(Boolean)
  };
  const exactArtifact = {
    type: 'numbered_framework',
    title: `Agent Exact Repair Framework: ${primary}`,
    items: unique([
      compactSentence(`Direct answer target: ${primary}`, 140),
      compactSentence(recommendation, 180),
      'Show the verification path and primary source boundary',
      'Separate current facts from provider or case-specific advice',
      'Route local next steps through the canonical provider destination'
    ])
  };
  const marker = `agent-exact-${crypto.createHash('sha256').update(unique(spec.record_ids||[spec.record_id]).join('|')).digest('hex').slice(0,10)}`;
  exactArtifact.marker = marker;
  const existing = (item.citation_velocity_artifacts||[]).filter(a => a && a.marker !== marker && !String(a.title||'').startsWith('Agent Exact Repair Framework:'));
  item.citation_velocity_artifacts = [exactArtifact, ...existing].slice(0,8);
  item.content_atom = deriveContentAtom({
    title: item.title,
    definition: item.answer || item.description,
    checklist: item.checklist,
    red_flags: item.red_flags,
    citation_velocity_artifacts: item.citation_velocity_artifacts
  }, { sourceRoute: item.publish_path || `/insights/${item.slug}.html`, title: item.title });
  return item;
}
function main(){
  const plan=readJson('artifacts/validation/agent-exact-implementation-plan.json', {specs:[]});
  const insightsPath='content/_live/insights.json';
  const insights=readJson(insightsPath,{items:[]});
  const bySlug=new Map((insights.items||[]).map(item=>[item.slug,item]));
  const results=[];
  let changed=0;
  for(const spec of plan.specs||[]){
    if(spec.operation !== 'REPAIR_INTENDED_WINNER_PAGE') { results.push({...spec, status: spec.status === 'BLOCKED' ? 'BLOCKED' : 'NOT_APPLIED_NON_REPAIR'}); continue; }
    const slug=slugFromPath(spec.implementation_path);
    const item=bySlug.get(slug);
    if(!item){ results.push({...spec, status:'BLOCKED_MISSING_TARGET', blocked_reason:'insight_item_not_found'}); continue; }
    const before=fileHash(insightsPath);
    repairInsight(item, spec);
    const afterPayload={...insights, items:(insights.items||[])};
    writeJson(insightsPath, afterPayload);
    const after=fileHash(insightsPath);
    changed += before !== after ? 1 : 0;
    results.push({...spec, before_hash:spec.before_hash, after_hash:fileHash(spec.implementation_path)||after, status:'APPLIED', applied_manifest:insightsPath});
  }
  const report={schema_version:'1.0', status:'PASS', applied_at:DATE, changed_items:changed, results};
  writeJson('artifacts/validation/agent-exact-implementation-apply.json', report);
  console.log(`AGENT EXACT IMPLEMENTATION APPLY PASS: changed_items=${changed}`);
}
main();
