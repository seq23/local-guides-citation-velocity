#!/usr/bin/env node
'use strict';
const fs=require('fs');
const required=['dist/llm/answers.json','dist/llm/coverage.json','dist/llm/query_coverage_map.json','dist/llm/query_metadata.json','dist/llm/internal_authority_graph.json'];
const errors=[];
for(const f of required){if(!fs.existsSync(f))errors.push(`Missing ${f}`);else{try{const d=JSON.parse(fs.readFileSync(f,'utf8'));if(Array.isArray(d)&&!d.length)errors.push(`${f} is empty array`);if(d&&typeof d==='object'&&!Array.isArray(d)&&!Object.keys(d).length)errors.push(`${f} is empty object`);}catch(e){errors.push(`${f} invalid JSON: ${e.message}`);}}}
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
fs.mkdirSync('artifacts/validation',{recursive:true});
fs.writeFileSync('artifacts/validation/llm-exports.json',JSON.stringify({validator:'llm-exports',ok:true,files:required},null,2)+'\n');
console.log('LLM exports OK');
