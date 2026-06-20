#!/usr/bin/env node
'use strict';
const {spawnSync}=require('child_process');const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');const max=Number(process.env.SELF_HEAL_MAX_ATTEMPTS||3);const stages=[];
function run(name,command,args=[]){const started=Date.now();const r=spawnSync(command,args,{cwd:ROOT,stdio:'inherit',env:process.env});stages.push({name,status:r.status===0?'PASS':'FAIL',duration_ms:Date.now()-started});return r.status===0;}
let repaired=false;
for(let attempt=1;attempt<=max;attempt++){
 if(!run(`source-repair-${attempt}`,'node',['scripts/content/self_heal_programmatic_content.js']))break;
 if(run(`source-quality-${attempt}`,'node',['scripts/content/validate_programmatic_substance.js'])){repaired=true;break;}
}
if(!repaired){fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/self-healing-pipeline.json'),JSON.stringify({status:'FAIL',stages},null,2)+'\n');process.exit(1);}
if(!run('render','npm',['run','build']))process.exit(1);
if(!run('admission-registry','node',['scripts/build_page_admission_registry_2026_06_19.js']))process.exit(1);
if(!run('route-registries','node',['scripts/build_full_scope_route_and_disposition_registries.js']))process.exit(1);
if(!run('render-quality','node',['scripts/validators/validate_generated_content_gate.js']))process.exit(1);
if(!run('substance-after-render','node',['scripts/content/validate_programmatic_substance.js']))process.exit(1);
const report={status:'PASS',advance_rule:'Every stage passed before the next stage began. Failed source quality is repaired and rescored up to the configured attempt limit.',stages,completed_at:process.env.SOURCE_DATE||'2026-06-19'};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/self-healing-pipeline.json'),JSON.stringify(report,null,2)+'\n');console.log('SELF-HEALING CONTENT PIPELINE PASS');
