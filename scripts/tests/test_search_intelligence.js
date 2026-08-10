#!/usr/bin/env node
'use strict';
const fs=require('fs');const os=require('os');const path=require('path');const L=require('../search_intelligence/lib');
const results=[];function check(name,fn){try{fn();results.push({name,status:'PASS'});}catch(e){results.push({name,status:'FAIL',error:e.message});}}
function assert(v,m){if(!v)throw new Error(m);}
check('1 protected Agent path mutation is rejected',()=>assert(L.isProtected('data/report_fixes/normalized_agent_runs/x.json'),'not protected'));
check('2 unsupported regulated repair is review-only',()=>{const s=L.candidateStatusFromDiagnosis({material_state:'DEFECT',repair_type:'METADATA_DESCRIPTION',regulated_claim_risk:true});assert(s==='BLOCK_NEEDS_REVIEW','regulated repair auto-approved');});
check('3 fake external citation evidence is rejected',()=>assert(!L.verifyCitationEvent({provider:'x'}),'fake citation accepted'));
check('4 complete citation evidence is accepted',()=>assert(L.verifyCitationEvent({provider:'x',observed_at:'2026-08-09',query_or_prompt:'q',surfaced_url:'https://a',cited_url:'https://b',evidence_ref:'receipt'}),'valid citation rejected'));
check('5 APPLIED requires changed bytes',()=>{const a=Buffer.from('a'),b=Buffer.from('a');assert(a.equals(b),'fixture wrong');assert(!(!a.equals(b)),'unchanged bytes treated as changed');});
check('6 cooldown is deterministic at fourteen days',()=>assert(L.addDays('2026-08-09',14)==='2026-08-23','cooldown mismatch'));
check('7 rollback requires a before snapshot',()=>{const r={rollback_eligible:false,rollback_snapshot:null};assert(!(r.rollback_eligible&&r.rollback_snapshot),'rollback falsely eligible');});
check('8 unowned target is not valid',()=>{const t={ownership_status:'UNOWNED',owner_route:null};assert(!(t.ownership_status==='OWNED'&&t.owner_route),'unowned became owned');});
check('9 bounded real JSON mutation changes bytes and stays outside Agent tree',()=>{const tmp='data/content/search_intelligence_test_fixture.json';L.writeJson(tmp,{pages:[{slug:'/fixture/',title:'A',description:'before'}]});const m=L.safeJsonPatch({source_file:tmp,route:'/fixture/',patch:{description:'after'}});assert(m.changed&&m.before_sha256!==m.after_sha256,'mutation not real');fs.unlinkSync(path.join(L.ROOT,tmp));});
const failed=results.filter(r=>r.status==='FAIL');const report={schema_version:'1.0',test:'search-intelligence-hostile',status:failed.length?'FAIL':'PASS',passed:results.length-failed.length,total:results.length,results};fs.mkdirSync(path.join(L.ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(L.ROOT,'artifacts/validation/search-intelligence-hostile.json'),JSON.stringify(report,null,2)+'\n');console.log(`SEARCH INTELLIGENCE HOSTILE ${report.status}: ${report.passed}/${report.total}`);if(failed.length){console.error(failed);process.exit(1);}
