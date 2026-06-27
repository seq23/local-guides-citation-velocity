#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs=require('fs');const path=require('path');const cp=require('child_process');const ROOT=path.resolve(__dirname,'..');
function run(args){const r=cp.spawnSync(process.execPath,args,{cwd:ROOT,stdio:'inherit',env:{...process.env,NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=3072'}});if(r.status!==0)process.exit(r.status||1);}
run(['scripts/citation_velocity/apply_agent_exact_implementation_plan.js']);
let legacyTouched=0;
try{if(fs.existsSync(path.join(ROOT,'scripts/apply_citation_agent_fixes_2026_05.js'))){const legacy=require('./apply_citation_agent_fixes_2026_05.js');if(legacy&&typeof legacy.applyCitationAgentFixes==='function')legacyTouched=legacy.applyCitationAgentFixes();}}catch(err){console.error(`LEGACY_CITATION_AGENT_FIX_APPLY_FAILED:${err.message}`);process.exit(1);}
const ledgerPath=path.join(ROOT,'data/report_fixes/agent_fix_ledger.json');const reportPath=path.join(ROOT,'artifacts/validation/citation-agent-fix-apply.json');fs.mkdirSync(path.dirname(reportPath),{recursive:true});
let cumulative=0;if(fs.existsSync(ledgerPath)){const ledger=JSON.parse(fs.readFileSync(ledgerPath,'utf8'));cumulative=(ledger.fixes||[]).length;ledger.last_apply_checked_at=process.env.SOURCE_DATE||new Date().toISOString().slice(0,10);fs.writeFileSync(ledgerPath,JSON.stringify(ledger,null,2)+'\n');}
fs.writeFileSync(reportPath,JSON.stringify({schema_version:'1.1',status:'PASS',exact_agent_implementation_applied:true,legacy_page_updates:legacyTouched,cumulative_fix_count:cumulative,checked_at:process.env.SOURCE_DATE||new Date().toISOString().slice(0,10)},null,2)+'\n');
console.log(`Citation-agent fixes apply PASS: exact=true, legacy=${legacyTouched}, cumulative=${cumulative}.`);
