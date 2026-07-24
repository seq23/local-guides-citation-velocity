#!/usr/bin/env node
'use strict';
const {spawnSync}=require('child_process');const path=require('path');
const ROOT=path.resolve(__dirname,'../..');const env=String(process.env.RELEASE_EXECUTION_ENV||'container').toLowerCase();
if(!['container','local'].includes(env)){console.error(`INVALID_RELEASE_EXECUTION_ENV:${env}`);process.exit(2);}console.log(`RELEASE PREPUSH PROFILE: ${env.toUpperCase()}`);
const base=['scripts/release/run_staged_release.js','--mode','validate','--resume'];const r=spawnSync(process.execPath,base,{cwd:ROOT,stdio:'inherit',env:{...process.env,NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=3072'}});if(r.status!==0)process.exit(r.status||1);
if(env==='local'){const b=spawnSync(process.execPath,['scripts/browser/run_local_public_click_audit.js'],{cwd:ROOT,stdio:'inherit',env:{...process.env,NODE_OPTIONS:process.env.NODE_OPTIONS||'--max-old-space-size=3072'}});if(b.status!==0)process.exit(b.status||1);}
