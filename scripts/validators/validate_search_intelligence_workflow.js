#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const L=require('../search_intelligence/lib');const errors=[];const dir=path.join(L.ROOT,'.github/workflows');const files=fs.readdirSync(dir).filter(x=>/\.ya?ml$/.test(x)).sort();// Derived from the workflow contract registry, not hardcoded. A literal count
// here drifts the moment a workflow is legitimately added: query-evidence-refresh.yml
// was admitted to the registry with a recorded reason and this check still failed
// the whole release on `workflow_count:9!=8`, blocking 57 later validators from
// even running. The registry is the declaration; this asserts the tree matches it.
const registry=(()=>{try{return JSON.parse(fs.readFileSync(path.join(L.ROOT,'data/workflows/workflow_contract_registry.json'),'utf8'))}catch{return null}})();
const declared=registry&&Array.isArray(registry.workflows)?registry.workflows.map(w=>w.file).filter(Boolean).sort():null;
if(declared){
  const missing=declared.filter(f=>!files.includes(f));
  const undeclared=files.filter(f=>!declared.includes(f));
  if(missing.length)errors.push(`workflow_declared_but_absent:${missing.join(',')}`);
  if(undeclared.length)errors.push(`workflow_present_but_undeclared:${undeclared.join(',')}`);
}else if(files.length!==8)errors.push(`workflow_count:${files.length}!=8`);const need=['search-intelligence-loop.yml','ci-health-recovery.yml'];for(const f of need)if(!files.includes(f))errors.push(`missing:${f}`);function text(f){return fs.readFileSync(path.join(dir,f),'utf8');}if(files.includes('search-intelligence-loop.yml')){const t=text('search-intelligence-loop.yml');for(const x of ['schedule:','workflow_dispatch:','npm run search:intelligence:closed-loop','npm run validate:search-intelligence'])if(!t.includes(x))errors.push(`search_workflow_missing:${x}`);}const post=text('postdeploy-public-audit.yml');if(!post.includes('schedule:'))errors.push('postdeploy_not_scheduled');if(!post.includes('workflow_run:'))errors.push('postdeploy_not_after_deploy');if(files.includes('ci-health-recovery.yml')){const t=text('ci-health-recovery.yml');for(const x of ['workflow_run:','Validate Repo','issues: write','scripts/search_intelligence/ci_health_alert.js'])if(!t.includes(x))errors.push(`ci_health_missing:${x}`);}const report={validator:'search-intelligence-workflow',status:errors.length?'FAIL':'PASS',workflow_count:files.length,errors};L.writeJson('artifacts/validation/search-intelligence-workflow.json',report);if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`SEARCH INTELLIGENCE WORKFLOW PASS: ${files.length} workflows`);
