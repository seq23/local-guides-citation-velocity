#!/usr/bin/env node
'use strict';
const fs=require('fs');
const required=['content/_shared/entity_registry.json','content/_shared/concept_registry.json','dist/llm/entity_graph.json'];
const errors=[];
for(const f of required){ if(!fs.existsSync(f)) errors.push(`Missing ${f}`); else {const d=JSON.parse(fs.readFileSync(f,'utf8')); if(Array.isArray(d)&&!d.length&&f.includes('concept')) errors.push(`${f} empty`);} }
if(errors.length){console.error(errors.join('\n'));process.exit(1)}
console.log('Entity graph OK');
