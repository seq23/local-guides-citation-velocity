#!/usr/bin/env node
'use strict';
const {readJson,writeJsonChecked}=require('../lib/llm_utils');
const clusters=readJson('data/community/clusters.json',[]);
const scored=(Array.isArray(clusters)?clusters:[]).map(c=>{
  const density = Number(c.count||0) * 10;
  const intent = Number(c.total_intent_score||0) * 3;
  const source = Number(c.total_source_weight||0) * 2;
  const mapped = c.mapped_publish_path ? 10 : 0;
  const score = density + intent + source + mapped;
  return {...c, score, publish_priority: score>=45?'high':score>=20?'review':'hold'};
}).sort((a,b)=>b.score-a.score);
writeJsonChecked('data/community/scored_clusters.json', scored);
console.log(`Scored ${scored.length} clusters`);
