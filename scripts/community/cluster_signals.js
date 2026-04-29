#!/usr/bin/env node
'use strict';
const {readJson,writeJsonChecked,slugify}=require('../lib/llm_utils');
const signals=readJson('data/community/mapped_signals.json', readJson('data/community/normalized_signals.json',[]));
const rows=Array.isArray(signals)?signals:signals.items||[];
const clusters={};
for(const s of rows){
  const key=slugify(s.target_key||`${s.vertical||'unknown'}-${s.mapped_cluster||s.cluster||s.query||s.title||'uncategorized'}`).slice(0,100)||'uncategorized';
  clusters[key] ||= {id:key, vertical:s.vertical||'unknown', cluster:s.mapped_cluster||s.cluster||'uncategorized', mapped_publish_path:s.mapped_publish_path||null, signals:[], count:0, total_intent_score:0, total_source_weight:0};
  clusters[key].signals.push(s);
  clusters[key].count++;
  clusters[key].total_intent_score += Number(s.intent_score||0);
  clusters[key].total_source_weight += Number(s.source_weight||0);
}
writeJsonChecked('data/community/clusters.json', Object.values(clusters).sort((a,b)=>b.count-a.count));
console.log(`Clustered ${rows.length} signals into ${Object.keys(clusters).length} clusters`);
