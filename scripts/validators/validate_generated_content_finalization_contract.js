#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const readJson=(rel)=>JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));
const pkg=readJson('package.json');
const contract=readJson('data/strategy/generated_content_finalization_contract.json');
const scripts=pkg.scripts||{};const errors=[];
function mustScript(name,fragments){const cmd=scripts[name]||'';if(!cmd){errors.push(`missing_script:${name}`);return;}for(const fragment of fragments)if(!cmd.includes(fragment))errors.push(`script_missing_fragment:${name}:${fragment}`);}
function mustFileFragments(rel,fragments){const abs=path.join(ROOT,rel);if(!fs.existsSync(abs)){errors.push(`missing_file:${rel}`);return;}const text=fs.readFileSync(abs,'utf8');for(const fragment of fragments)if(!text.includes(fragment))errors.push(`file_missing_fragment:${rel}:${fragment}`);}
mustScript('release:velocity-content',['strategy:opportunities','strategy:release-queue','release:velocity-content:raw']);
mustScript('release:apply',['release:velocity-content','release:content-finalize']);
mustScript('release:velocity-intake',['release:velocity-content','citation:apply-agent-exact','release:content-finalize']);
mustFileFragments('scripts/release/finalize_content_release.js',[
  'consumePendingMutationRoutes','beginMutationScope','promote_staged_content.js','run_source_self_heal_loop.js','npm run build','validate_rendered_programmatic_substance.js','validate_rich_new_page_contract.js','validate_page_family_contract.js','build_page_admission_registry_2026_06_19.js','freezeNewAdmitted','acceptMutationScope','validate_page_release_law.js','build_pages_dist.js','rollbackMutationScope'
]);
mustFileFragments('scripts/build_site.js',['normal builds never copy staged content into LIVE','restoreFrozenPages']);
for(const field of ['required_finish_sequence','forbidden_finish_states','finish_command','canonical_apply_command'])if(!(field in contract))errors.push(`contract_missing:${field}`);
if(!Array.isArray(contract.required_finish_sequence)||!contract.required_finish_sequence.includes('freeze_new_and_refreeze_authorized_routes'))errors.push('contract_missing_freeze_finish_stage');
const report={schema_version:'2.0',validator:'generated-content-finalization-contract',status:errors.length?'FAIL':'PASS',checked_scripts:['release:velocity-content','release:apply','release:velocity-intake'],checked_files:['scripts/release/finalize_content_release.js','scripts/build_site.js'],errors};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/generated-content-finalization-contract.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(JSON.stringify(report,null,2));process.exit(1);}console.log('GENERATED CONTENT FINALIZATION CONTRACT PASS');
