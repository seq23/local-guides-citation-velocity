#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const staged=path.join(ROOT,'content/_staged');
const live=path.join(ROOT,'content/_live');
if(!process.argv.includes('--confirm-recovery-bootstrap')){
  console.error('Refusing implicit staged→live bootstrap. Re-run with --confirm-recovery-bootstrap only for an intentional recovery/bootstrap operation.');
  process.exit(2);
}
fs.mkdirSync(live,{recursive:true});
const existing=fs.readdirSync(live).filter((f)=>f.endsWith('.json'));
if(existing.length){console.error(`Refusing bootstrap: LIVE already contains ${existing.length} JSON file(s).`);process.exit(1);}
let copied=0;
for(const file of fs.readdirSync(staged).filter((f)=>f.endsWith('.json'))){fs.copyFileSync(path.join(staged,file),path.join(live,file));copied+=1;}
console.log(`RECOVERY BOOTSTRAP COMPLETE: copied ${copied} staged JSON files to LIVE.`);
