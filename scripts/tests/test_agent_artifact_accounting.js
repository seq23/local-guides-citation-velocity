#!/usr/bin/env node
'use strict';
const assert = require('assert');

function normalize(value){ return String(value||'').replace(/\s+/g,' ').trim().toLowerCase(); }
function analyze(rows){
  const queries=new Set(); const observations=new Set(); const models=new Set(); const missing=[];
  rows.forEach((row,index)=>{ const q=normalize(row.Query||row.query); const m=normalize(row.Model||row.model); if(!q){missing.push(index);return;} queries.add(q); if(m){models.add(m); observations.add(`${q}|${m}`);} });
  return {rows:rows.length,queries:queries.size,models:models.size,observations:observations.size,missing};
}
function interpret(total,a){
  if(!total) return 'UNDETERMINED';
  if(total===a.rows) return 'PHYSICAL_CSV_ROW_COUNT';
  if(total===a.queries) return 'UNIQUE_QUERY_COUNT';
  if(total===a.observations) return 'UNIQUE_QUERY_MODEL_OBSERVATION_COUNT';
  return 'PRODUCER_DEFINED_OR_UNKNOWN';
}
function makeRows(queryCount, models){ const rows=[]; for(let i=0;i<queryCount;i++) for(const model of models) rows.push({Query:`query ${i+1}`,Model:model}); return rows; }
let a=analyze(makeRows(18,['GPT-4o','Perplexity','Google AI Overview']));
assert.deepStrictEqual({rows:a.rows,queries:a.queries,models:a.models,observations:a.observations},{rows:54,queries:18,models:3,observations:54});
assert.strictEqual(interpret(18,a),'UNIQUE_QUERY_COUNT');
a=analyze(makeRows(18,['GPT-4o','Perplexity']));
assert.strictEqual(interpret(36,a),'PHYSICAL_CSV_ROW_COUNT');
a=analyze(makeRows(17,['Perplexity']));
assert.strictEqual(interpret(17,a),'PHYSICAL_CSV_ROW_COUNT');
const irregular=[]; for(let i=0;i<18;i++){ irregular.push({Query:`query ${i}`,Model:'GPT-4o'}); if(i%2===0) irregular.push({Query:`query ${i}`,Model:'Perplexity'}); if(i%3===0) irregular.push({Query:`query ${i}`,Model:'Google AI Overview'}); }
a=analyze(irregular); assert.strictEqual(a.queries,18); assert.strictEqual(interpret(18,a),'UNIQUE_QUERY_COUNT');
assert.strictEqual(interpret(15,a),'PRODUCER_DEFINED_OR_UNKNOWN');
a=analyze([{Query:'ok',Model:'GPT-4o'},{Query:'',Model:'Perplexity'}]); assert.deepStrictEqual(a.missing,[1]);
const discovered=new Set(['a','b','c']); const accounted=new Set(['a','b']); const missing=[...discovered].filter(id=>!accounted.has(id)); assert.deepStrictEqual(missing,['c']);
console.log('AGENT ARTIFACT ACCOUNTING TEST PASS: grain-aware counts and source-record continuity behaviors verified.');
