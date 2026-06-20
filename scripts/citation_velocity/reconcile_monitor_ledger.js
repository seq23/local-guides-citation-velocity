#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const specs=[
  {file:'recommendations.json',array:'recommendations',date:'run_date',countFields:['current_count']},
  {file:'runs.json',array:'runs',date:'date',countFields:['count','current_count']},
  {file:'wins.json',array:'wins',date:'date',countFields:['count','current_count']}
];
function maxDate(rows,key){return rows.map(r=>String(r[key]||'')).filter(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)).sort().at(-1)||null;}
for(const spec of specs){const p=path.join(ROOT,'data/citation_velocity',spec.file);const d=JSON.parse(fs.readFileSync(p,'utf8'));const rows=d[spec.array]||[];for(const field of spec.countFields)d[field]=rows.length;d.current_through=maxDate(rows,spec.date);fs.writeFileSync(p,JSON.stringify(d,null,2)+'\n');console.log(`${spec.file}: count=${rows.length} through=${d.current_through}`);}
const ownPath=path.join(ROOT,'data/citation_velocity/source_ownership_registry.json');if(fs.existsSync(ownPath)){const d=JSON.parse(fs.readFileSync(ownPath,'utf8'));d.count=(d.records||[]).length;fs.writeFileSync(ownPath,JSON.stringify(d,null,2)+'\n');}
console.log('MONITOR LEDGER METADATA RECONCILED');
