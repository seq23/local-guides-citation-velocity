#!/usr/bin/env node
'use strict';
const fs=require('fs');const f='dist/llm/answer_blocks.json';
if(!fs.existsSync(f)){console.error(`Missing ${f}`);process.exit(1);}
const rows=JSON.parse(fs.readFileSync(f,'utf8'));const bad=Array.isArray(rows)?rows.filter(x=>!x.id||!x.url||!x.title||!x.answer_block||x.answer_block.length<40):[];
if(!Array.isArray(rows)||!rows.length||bad.length){console.error(`Invalid answer blocks: ${bad.length}`);process.exit(1);}
fs.mkdirSync('artifacts/validation',{recursive:true});fs.writeFileSync('artifacts/validation/answer-blocks.json',JSON.stringify({validator:'answer-blocks',ok:true,count:rows.length},null,2)+'\n');
console.log('Answer blocks OK');
