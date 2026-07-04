#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path'); const ROOT=path.resolve(__dirname,'../..');
function readJson(rel,fallback=null){const p=path.join(ROOT,rel); if(!fs.existsSync(p)) return fallback; return JSON.parse(fs.readFileSync(p,'utf8'));}
function writeJson(rel,payload){const p=path.join(ROOT,rel); fs.mkdirSync(path.dirname(p),{recursive:true}); fs.writeFileSync(p,JSON.stringify(payload,null,2)+'\n');}
function exists(rel){return fs.existsSync(path.join(ROOT,rel));}
function main(){
 const checklist=readJson('artifacts/release/IMPLEMENTATION_COMPLETION_CHECKLIST_2026-07-03.json',{});
 const readiness=readJson('artifacts/validation/controlled-release-readiness.json',{});
 const inv=readJson('artifacts/validation/workflow-yaml-inventory.json',{});
 const actual=exists('.github/workflows')?fs.readdirSync(path.join(ROOT,'.github/workflows')).filter(x=>/\.ya?ml$/.test(x)).length:0;
 const errors=[];
 if(readiness.status!=='PASS') errors.push('controlled-release-readiness must pass');
 if(!Array.isArray(checklist.items)||!checklist.items.length) errors.push('completion checklist items missing');
 for(const item of checklist.items||[]) if(item.status!=='DONE') errors.push(`checklist item not done: ${item.id}`);
 if(inv.workflow_count!==actual) errors.push(`workflow inventory count drift: inventory=${inv.workflow_count} actual=${actual}`);
 if(!exists('docs/runbooks/CONTROLLED_RELEASE_LANE.md')) errors.push('missing controlled release runbook');
 const report={schema_version:'1.0',repo:'local-guides-citation-velocity',validator:'batch-de-completion',generated_at:new Date().toISOString(),status:errors.length?'FAIL':'PASS',workflow_count:actual,checklist_items:(checklist.items||[]).length,errors};
 writeJson('artifacts/validation/batch-de-completion.json',report);
 if(errors.length){console.error(errors.join('\n'));process.exit(1);} console.log('batch D/E completion PASS');
}
main();
