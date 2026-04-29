#!/usr/bin/env node
'use strict';
const {readJson,writeJsonChecked,slugify}=require('./lib/llm_utils');
const answers=readJson('dist/llm/answer_blocks.json',[]);
const graph=readJson('dist/llm/entity_graph.json',{concepts:[],entities:[]});
if(!answers.length) throw new Error('Missing answer_blocks; run npm run build:answer-blocks first');
const targets=answers.map(a=>({id:`citation:${a.id}`, url:a.url, title:a.title, citation_reason:'Direct answer block with stable URL and extracted snippet.', evidence_length:a.answer_block.length, related_concepts:(graph.concepts||[]).filter(c=>slugify(a.title).includes(slugify(c.name).slice(0,20))).slice(0,5).map(c=>c.id)}));
writeJsonChecked('dist/llm/citation_targets.json', targets);
console.log(`Citation targets built: ${targets.length}`);
