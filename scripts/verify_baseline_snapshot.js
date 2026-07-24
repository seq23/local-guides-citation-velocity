#!/usr/bin/env node
'use strict';
const cp=require('child_process'),crypto=require('crypto'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib');
const ZIP=path.resolve(process.argv[2]||'');
if(!ZIP||!fs.existsSync(ZIP)){console.error('Usage: node scripts/validate_baseline_snapshot.js <zip>');process.exit(2);}
const sha=(buf)=>crypto.createHash('sha256').update(buf).digest('hex');
const fileSha=(p)=>sha(fs.readFileSync(p));
function run(cmd,args){const r=cp.spawnSync(cmd,args,{encoding:'utf8',maxBuffer:64*1024*1024});if(r.status!==0)throw new Error(`${cmd} failed: ${r.stderr||r.stdout}`);return r.stdout||'';}
function fail(errors,msg){errors.push(msg);}
const errors=[];
try{run('unzip',['-t',ZIP]);}catch(e){fail(errors,`zip_integrity:${e.message}`);}
const entries=run('unzip',['-Z1',ZIP]).split(/\r?\n/).filter(Boolean);
const roots=[...new Set(entries.map((e)=>e.split('/')[0]).filter(Boolean))];
if(roots.length!==1)fail(errors,`unexpected_zip_roots:${roots.join(',')}`);
const forbiddenEntryPatterns=[/(^|\/)\.git\//,/(^|\/)node_modules\//,/(^|\/)\.build\//,/(^|\/)logs\//,/(^|\/)artifacts\/validation\/runtime\//,/(^|\/)\.env(?:\.|$)/];
for(const entry of entries){for(const re of forbiddenEntryPatterns){if(re.test(entry)){fail(errors,`forbidden_archive_entry:${entry}`);break;}}}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'velocity-zip-verify-'));
try{
 run('unzip',['-q',ZIP,'-d',tmp]);
 const root=path.join(tmp,roots[0]||'');
 const contract=JSON.parse(fs.readFileSync(path.join(root,'_baseline_packaging_contract.json'),'utf8'));
 if(roots[0]!==contract.required_wrapper)fail(errors,`wrapper_mismatch:${roots[0]}:${contract.required_wrapper}`);
 for(const rel of contract.required||[]){if(!fs.existsSync(path.join(root,rel)))fail(errors,`required_missing:${rel}`);}
 for(const rel of contract.updater_required_runtime_artifacts||[]){if(!fs.existsSync(path.join(root,rel.replace(/\/$/,''))))fail(errors,`updater_required_missing:${rel}`);}
 const manifest=JSON.parse(fs.readFileSync(path.join(root,contract.hash_manifest||'_artifact_validation_manifest.json'),'utf8'));
 for(const item of manifest.release_critical_files||[]){
   const abs=path.join(root,item.path);
   if(!fs.existsSync(abs)){fail(errors,`manifest_file_missing:${item.path}`);continue;}
   const st=fs.statSync(abs); if(st.size!==Number(item.size_bytes))fail(errors,`manifest_size_mismatch:${item.path}:${st.size}:${item.size_bytes}`);
   const h=fileSha(abs); if(h!==item.sha256)fail(errors,`manifest_hash_mismatch:${item.path}`);
 }
 const legacy=path.join(root,'data/queries/citation_fanout_opportunities_100k.json');
 if(fs.existsSync(legacy))fail(errors,'legacy_100k_monolith_present');
 const idxPath=path.join(root,'data/queries/citation_fanout_opportunities_100k/index.json');
 if(!fs.existsSync(idxPath))fail(errors,'fanout_shard_index_missing');
 else{
   const idx=JSON.parse(fs.readFileSync(idxPath,'utf8'));let count=0;const ids=new Set();const agg=[];
   for(const s of idx.shards||[]){const abs=path.join(root,s.path);if(!fs.existsSync(abs)){fail(errors,`shard_missing:${s.path}`);continue;}const buf=fs.readFileSync(abs);if(buf.length!==Number(s.byte_count))fail(errors,`shard_size:${s.path}`);if(sha(buf)!==s.sha256)fail(errors,`shard_hash:${s.path}`);let d;try{d=JSON.parse(buf);}catch(e){fail(errors,`shard_json:${s.path}:${e.message}`);continue;}if((d.records||[]).length!==Number(s.record_count))fail(errors,`shard_count:${s.path}`);for(const r of d.records||[]){count++;if(!r.opportunity_id)fail(errors,`shard_missing_id:${s.path}`);else if(ids.has(r.opportunity_id))fail(errors,`shard_duplicate_id:${r.opportunity_id}`);else ids.add(r.opportunity_id);}agg.push(`${s.part}:${s.record_count}:${s.sha256}:${s.first_id}:${s.last_id}`);}
   if(count!==Number(idx.record_count)||count!==100000)fail(errors,`fanout_total:${count}:${idx.record_count}`);
   if(sha(Buffer.from(agg.join('\n'),'utf8'))!==idx.aggregate_sha256)fail(errors,'fanout_aggregate_hash_mismatch');
 }
 const admission=JSON.parse(fs.readFileSync(path.join(root,'data/content/page_admission_registry.json'),'utf8'));
 const frozen=JSON.parse(fs.readFileSync(path.join(root,'data/release/frozen_page_registry.json'),'utf8'));
 if((frozen.pages||[]).length!==(admission.pages||[]).length)fail(errors,`frozen_count:${(frozen.pages||[]).length}:${(admission.pages||[]).length}`);
 for(const r of frozen.pages||[]){
   if(r.state!=='FROZEN')fail(errors,`frozen_state:${r.route}:${r.state}`);
   const cache=path.join(root,r.cache_file||'');if(!fs.existsSync(cache)){fail(errors,`frozen_cache_missing:${r.route}`);continue;}const gz=fs.readFileSync(cache);if(sha(gz)!==r.cache_sha256)fail(errors,`frozen_cache_hash:${r.route}`);let html;try{html=zlib.gunzipSync(gz);}catch(e){fail(errors,`frozen_gzip:${r.route}`);continue;}if(sha(html)!==r.accepted_html_sha256)fail(errors,`frozen_accepted_hash:${r.route}`);const rendered=path.join(root,r.rendered_file||'');if(!fs.existsSync(rendered))fail(errors,`frozen_rendered_missing:${r.route}`);else if(fileSha(rendered)!==r.accepted_html_sha256)fail(errors,`frozen_rendered_hash:${r.route}`);
 }
 const dist=path.join(root,'dist');if(!fs.existsSync(dist))fail(errors,'dist_missing');
 else {
   const admitted=new Set((admission.pages||[]).map((p)=>String(p.path||'')));
   const routeToDistRel=(route)=>{if(route==='/')return 'index.html';if(String(route).endsWith('.html'))return String(route).replace(/^\//,'');return `${String(route).replace(/^\//,'').replace(/\/$/,'')}/index.html`;};
   for(const route of admitted){const rel=routeToDistRel(route);if(!fs.existsSync(path.join(dist,rel)))fail(errors,`dist_admitted_missing:${route}:${rel}`);}
   const walk=(dir)=>{for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const abs=path.join(dir,ent.name);if(ent.isDirectory())walk(abs);else if(ent.isFile()){const rel=path.relative(dist,abs).replace(/\\/g,'/');if(/^(data|content|scripts|artifacts|reports|docs|templates)\//.test(rel))fail(errors,`dist_internal_leak:${rel}`);if(rel.endsWith('.html')&&rel!=='404.html'){const route=rel==='index.html'?'/':rel.endsWith('/index.html')?`/${rel.slice(0,-'index.html'.length)}`:`/${rel}`;if(!admitted.has(route))fail(errors,`dist_unadmitted_html:${route}`);}}}};walk(dist);
 }
 const activeScope=path.join(root,'data/release/active_mutation_scope.json');if(fs.existsSync(activeScope))fail(errors,'active_mutation_scope_packaged');
 const strategy=JSON.parse(fs.readFileSync(path.join(root,'data/strategy/page_strategy_registry.json'),'utf8'));
 if(strategy.runtime_autonomy!=='FULL_SAFE_AUTONOMY')fail(errors,'strategy_runtime_autonomy_mismatch');
 const queue=JSON.parse(fs.readFileSync(path.join(root,'data/release/page_release_queue.json'),'utf8'));
 for(const r of queue.records||[]){if(r.eligible&&!(r.decision==='SAFE_AUTOPUBLISH'&&r.lifecycle_state==='ADMITTED_FOR_BUILD'))fail(errors,`release_queue_invalid_eligible:${r.id}`);if(r.eligible&&/STRATEGY_GAP_FILL/i.test(`${r.source||''} ${r.admission_basis||''}`))fail(errors,`release_queue_synthetic_quota_source:${r.id}`);}
 const report={schema_version:'2.0',status:errors.length?'FAIL':'PASS',zip:path.basename(ZIP),zip_sha256:fileSha(ZIP),wrapper:roots[0]||null,entry_count:entries.length,release_critical_files:(manifest.release_critical_files||[]).length,admitted_routes:(admission.pages||[]).length,frozen_routes:(frozen.pages||[]).length,fanout_records:Number((fs.existsSync(idxPath)&&JSON.parse(fs.readFileSync(idxPath,'utf8')).record_count)||0),safe_autopublish_records:(queue.records||[]).filter((r)=>r.eligible).length,errors};
 const sidecar=`${ZIP}.verification.json`;fs.writeFileSync(sidecar,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report,null,2));
 if(errors.length)process.exitCode=1;
} finally {fs.rmSync(tmp,{recursive:true,force:true});}
