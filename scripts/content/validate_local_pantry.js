#!/usr/bin/env node
const fs=require('fs'), path=require('path');
function writeReport(report){fs.mkdirSync('reports',{recursive:true});fs.mkdirSync('artifacts/validation',{recursive:true});fs.writeFileSync('reports/local-pantry-validation.json',JSON.stringify(report,null,2)+'\n');fs.writeFileSync('artifacts/validation/local-pantry.json',JSON.stringify(report,null,2)+'\n');}
const bank=path.join(process.cwd(),'content-bank');
const required=['city-service-matrix.json','local-enrichment-banks.json','neighborhood-context-banks.json','seasonal-local-event-banks.json','budget-planning-banks.json','comparison-banks.json','vendor-evaluation-banks.json','checklist-banks.json','booking-question-banks.json','price-factor-banks.json','timeline-preparation-banks.json','page-recipes.json','anti-thin-page-rules.json','nap-citation-registry.json'];
let errors=[]; for(const f of required){const p=path.join(bank,f); if(!fs.existsSync(p)) errors.push(`missing ${f}`); else {try{JSON.parse(fs.readFileSync(p,'utf8'))}catch(e){errors.push(`invalid json ${f}: ${e.message}`)}}}
const minimums={'neighborhood-context-banks.json':100,'seasonal-local-event-banks.json':100,'budget-planning-banks.json':75,'comparison-banks.json':75,'vendor-evaluation-banks.json':75,'checklist-banks.json':75,'booking-question-banks.json':50,'price-factor-banks.json':50,'timeline-preparation-banks.json':50};
for(const [f,min] of Object.entries(minimums)){ if(fs.existsSync(path.join(bank,f))){const n=JSON.parse(fs.readFileSync(path.join(bank,f),'utf8')).blocks?.length||0; if(n<min) errors.push(`${f} below minimum ${min}`)}}
const report={status:errors.length?'FAIL':'PASS',repo:'local-guides-citation-velocity',pantry:'local',files:required.length,errors}; writeReport(report);
console[errors.length?'error':'log'](JSON.stringify(report,null,2)); if(errors.length) process.exit(1);
