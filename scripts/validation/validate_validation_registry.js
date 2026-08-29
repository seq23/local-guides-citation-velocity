#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const {ROOT,readRegistry,buildMatrix,topologicalValidators,norm}=require('./registry_lib');
const errors=[];const check=(c,m)=>{if(!c)errors.push(m);};let reg,matrix,pkg;
try{reg=readRegistry();}catch(e){errors.push(`registry-read:${e.message}`);}try{matrix=JSON.parse(fs.readFileSync(path.join(ROOT,'_repo_validation_matrix.json'),'utf8'));}catch(e){errors.push(`matrix-read:${e.message}`);}try{pkg=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));}catch(e){errors.push(`package-read:${e.message}`);}
function walk(dir,out=[]){if(!fs.existsSync(dir))return out;for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())walk(p,out);else out.push(p);}return out;}
if(reg){
 check(reg.schema_version==='3.0','registry:schema-version');check(Boolean(reg.lineage_policy),'registry:missing-lineage-policy');check(Array.isArray(reg.lineage_policy?.source_roots)&&reg.lineage_policy.source_roots.length>3,'registry:source-roots');
 const severities=new Set(['HARD_FAIL','STRONG_WARNING','SOFT_WARNING','INFO']);const scopes=new Set(['CONTAINER','LOCAL_ONLY']);const statuses=new Set(['ACTIVE','ON_DEMAND','RETIRED']);const ids=new Set(),paths=new Set();
 for(const v of reg.validators||[]){check(v.id&&!ids.has(v.id),`registry:duplicate-id:${v.id}`);ids.add(v.id);check(v.path&&!paths.has(v.path),`registry:duplicate-path:${v.path}`);paths.add(v.path);check(severities.has(v.severity),`registry:severity:${v.id}`);check(scopes.has(v.scope),`registry:scope:${v.id}`);check(statuses.has(v.status),`registry:status:${v.id}`);check(fs.existsSync(path.join(ROOT,v.path)),`registry:missing-path:${v.id}:${v.path}`);check(Number.isInteger(v.timeout_seconds)&&v.timeout_seconds>0,`registry:timeout:${v.id}`);check(typeof v.risk_prevented==='string'&&v.risk_prevented.length>20,`registry:risk:${v.id}`);check(typeof v.why_existing_checks_do_not_cover==='string'&&v.why_existing_checks_do_not_cover.length>20,`registry:coverage-reason:${v.id}`);
  for(const field of ['depends_on','requires_files','prepare_commands','prepare_produces_files','prepare_mutates_files','produces_files','mutates_files'])check(Array.isArray(v[field]),`registry:${field}:${v.id}`);
  for(const dep of v.depends_on||[])check(dep!==v.id&&ids.has(dep)||reg.validators.some(x=>x.id===dep),`registry:unknown-dependency:${v.id}:${dep}`);
  for(const rel of [...(v.requires_files||[]),...(v.prepare_produces_files||[]),...(v.prepare_mutates_files||[]),...(v.produces_files||[]),...(v.mutates_files||[])])check(!path.isAbsolute(rel)&&!norm(rel).startsWith('../'),`registry:absolute-or-parent-path:${v.id}:${rel}`);
  if(v.status==='RETIRED'){check((v.replacement_ids||[]).length>0,`registry:retired-replacement:${v.id}`);check(Boolean(v.retirement_reason),`registry:retired-reason:${v.id}`);check((v.profiles||[]).length===0,`registry:retired-profile:${v.id}`);}else{check((v.profiles||[]).length>0,`registry:active-profile:${v.id}`);for(const p of v.profiles||[])check(Boolean(reg.profiles[p]),`registry:unknown-profile:${v.id}:${p}`);}
  const cosmeticText=[v.id,v.title,v.risk_prevented,...(v.tags||[])].join(' ').toLowerCase();
  if(v.severity==='HARD_FAIL'&&/(trailing whitespace|blank lines?|indentation|cosmetic formatting)/.test(cosmeticText))check(false,`registry:cosmetic-hard-fail-forbidden:${v.id}`);
  if(v.severity==='HARD_FAIL'&&v.status!=='RETIRED'&&fs.existsSync(path.join(ROOT,v.path))){
    const source=fs.readFileSync(path.join(ROOT,v.path),'utf8');
    const frozenInventoryPatterns=[
      /specs\.pages\.length\s*={2,3}\s*412/,
      /VELOCITY_QUESTION_200[^\n]{0,160}length\s*[,=]{1,3}\s*200/,
      /VELOCITY_DISAMBIGUATOR_20[^\n]{0,160}length\s*[,=]{1,3}\s*20/
    ];
    if(frozenInventoryPatterns.some(re=>re.test(source)))check(false,`registry:frozen-inventory-equality-forbidden:${v.id}`);
  }
 }
 try{topologicalValidators(reg,reg.validators.filter(v=>v.status!=='RETIRED').map(v=>v.id));}catch(e){errors.push(`registry:dependency-graph:${e.message}`);}
 const discovered=walk(path.join(ROOT,'scripts')).filter(p=>p.endsWith('.js')||p.endsWith('.py')).map(p=>norm(path.relative(ROOT,p))).filter(rel=>path.basename(rel).startsWith('validate')||['scripts/preflight_velocity_integrity.js','scripts/audit_all.js','scripts/browser/public_click_audit.js'].includes(rel)).sort();for(const rel of discovered)check(paths.has(rel),`registry:unregistered-script:${rel}`);for(const rel of paths)check(discovered.includes(rel),`registry:path-not-validator:${rel}`);
 const expected=buildMatrix(reg);check(matrix&&JSON.stringify(matrix)===JSON.stringify(expected),'matrix:not-generated-from-current-registry');
}
if(pkg){const runner='scripts/validation/run_validation_registry.js';for(const [name,cmd] of Object.entries(pkg.scripts||{})){if(name==='validate'||name.startsWith('validate:')||name==='preflight:integrity'||name==='audit:all'){check(String(cmd).includes(runner),`package:validation-alias-bypasses-registry:${name}`);for(const banned of ['daily_release.js','release_batch.js','build_site.js','git push','git commit','collect_signals.js','export_lkg_candidates.js'])check(!String(cmd).includes(banned),`package:validation-alias-mutates:${name}:${banned}`);}}check(pkg.scripts?.['validate:all']==='node scripts/validation/run_validation_registry.js --profile core','package:validate-all-not-core-profile');check(pkg.scripts?.['validate:release']==='node scripts/validation/run_validation_registry.js --profile release','package:validate-release-not-release-profile');check(pkg.scripts?.['validate:strict']==='node scripts/validation/run_validation_registry.js --profile strict','package:validate-strict-not-strict-profile');}
const report={validator:'validation-registry',ok:errors.length===0,schema_version:reg?.schema_version||null,registered_count:reg?.validators?.length||0,active_count:reg?.validators?.filter(v=>v.status==='ACTIVE').length||0,on_demand_count:reg?.validators?.filter(v=>v.status==='ON_DEMAND').length||0,retired_count:reg?.validators?.filter(v=>v.status==='RETIRED').length||0,dependency_edges:reg?.validators?.reduce((n,v)=>n+(v.depends_on||[]).length,0)||0,preparers:reg?.validators?.filter(v=>(v.prepare_commands||[]).length).length||0,errors};fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/validation-registry.json'),JSON.stringify(report,null,2)+'\n');
// ---------------------------------------------------------------- dead prepares
// prepare_commands run ONLY when a requires_files entry is missing. A validator
// that declares a prepare while every prerequisite it names is a committed file
// has a prepare that can never fire. Sixteen such declarations sat in this
// registry, and production run 33267988587 logged ZERO "PREPARE" lines while its
// own banner printed "prerequisites=ON" - the configuration described a refresh
// the runner never performed. Dead configuration that reads as a guarantee is
// worse than no configuration, so it is a hard error here.
try {
  const { execFileSync } = require('child_process');
  const isTracked = (f) => { try { execFileSync('git', ['ls-files', '--error-unmatch', f], { stdio: 'ignore' }); return true; } catch { return false; } };
  for (const v of ((reg && reg.validators) || [])) {
    if (v.status === 'RETIRED') continue;
    const prep = v.prepare_commands || [];
    if (!prep.length) continue;
    const req = v.requires_files || [];
    if (!req.length) {
      errors.push(`registry:unreachable-prepare:${v.id}: declares prepare_commands but no requires_files, so the prepare can never fire. Name the generated artifact it produces, or remove the prepare.`);
      continue;
    }
    if (req.every(isTracked)) {
      errors.push(`registry:unreachable-prepare:${v.id}: declares prepare_commands ${JSON.stringify(prep)} but every requires_files entry is a committed file, so the prerequisite is never missing and the prepare has never run. Point requires_files at the generated artifact, or remove the prepare and say the validator grades the committed tree.`);
    }
  }
} catch (e) {
  errors.push(`registry:unreachable-prepare-check-failed:${e.message}`);
}

if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log(`VALIDATION REGISTRY PASS (${report.registered_count} registered; ${report.dependency_edges} dependency edges; ${report.preparers} prerequisite builders)`);
