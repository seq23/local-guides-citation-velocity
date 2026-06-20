#!/usr/bin/env node
'use strict';
const fs=require('fs');const f='dist/llm/citation_targets.json';
if(!fs.existsSync(f)){console.error(`Missing ${f}`);process.exit(1);}
const rows=JSON.parse(fs.readFileSync(f,'utf8'));const bad=Array.isArray(rows)?rows.filter(x=>!x.id||!x.url||!x.title||!x.citation_reason):[];
if(!Array.isArray(rows)||!rows.length||bad.length){console.error(`Invalid citation targets: ${bad.length}`);process.exit(1);}
fs.mkdirSync('artifacts/validation',{recursive:true});fs.writeFileSync('artifacts/validation/citation-targets.json',JSON.stringify({validator:'citation-targets',ok:true,count:rows.length},null,2)+'\n');
console.log('Citation targets OK');
