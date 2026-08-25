#!/usr/bin/env node
'use strict';
function publicRoute(route){
 // Cloudflare Pages serves `foo.html` at `/foo` and 308-redirects the `.html`
 // form. PAGE_RELEASE_LAW.md §4 requires the canonical to identify the admitted
 // route; the route is the internal identifier, and this is the public URL that
 // actually returns 200. Comparing against the `.html` form forced every
 // canonical and sitemap entry to name a redirect, which Google declines to
 // index. Directory routes are already extensionless and pass through.
 const r=String(route||'');
 return r.endsWith('.html')?r.slice(0,-5):r;
}
const fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const contract=read('data/release/page_release_contract.json');
const admission=read('data/content/page_admission_registry.json');
const retirements=read(contract.approved_retirement_registry||'data/release/route_retirements.json');
const frozen=read(contract.frozen_page_registry||'data/release/frozen_page_registry.json');
const frozenByRoute=new Map((frozen.pages||[]).map((row)=>[String(row.route||''),row]));
const pageStrategy=read(contract.page_strategy_registry||'data/strategy/page_strategy_registry.json');
const releaseQueue=read(contract.page_release_queue||'data/release/page_release_queue.json');

const activeScopePath=path.join(ROOT,contract.active_mutation_scope||'data/release/active_mutation_scope.json');
const sha256=(buf)=>crypto.createHash('sha256').update(buf).digest('hex');

const pages=admission.pages||[]; const errors=[]; const warnings=[];
const sitemapFiles=['sitemap.xml',...fs.readdirSync(path.join(ROOT,'sitemaps')).filter(x=>x.endsWith('.xml')).map(x=>'sitemaps/'+x)];
const sitemap=sitemapFiles.map(f=>fs.readFileSync(path.join(ROOT,f),'utf8')).join('\n');
const seen=new Set();
function renderedFile(route){
 if(route==='/')return path.join(ROOT,'index.html');
 if(route.endsWith('.html'))return path.join(ROOT,route.slice(1));
 return path.join(ROOT,route.replace(/^\//,'').replace(/\/$/,''),'index.html');
}
function count(re,s){return (s.match(re)||[]).length;}
function clean(v){return String(v??'').trim();}
for(const p of pages){
 const route=clean(p.path);
 if(!route.startsWith('/'))errors.push(`${route||'<missing>'}:invalid_path`);
 if(seen.has(route))errors.push(`${route}:duplicate_path`); seen.add(route);
 for(const f of contract.required_common_fields||[])if(!clean(p[f]))errors.push(`${route}:${f}_missing`);
 if(p.publication_status!==contract.required_publication_status)errors.push(`${route}:not_admitted`);
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(clean(p.lastmod)))errors.push(`${route}:lastmod_format`);
 for(const raw of [p.source_file,p.generator])for(const rel of clean(raw).split(/\s*\+\s*/).filter(Boolean)){if(rel.startsWith('/'))continue;if(!fs.existsSync(path.join(ROOT,rel)))errors.push(`${route}:trace_file_missing:${rel}`);}
 if(p.programmatic_gate_status===contract.programmatic_gate_value){
   if(!Array.isArray(p.required_sources))errors.push(`${route}:programmatic_sources_not_declared`);
   if(!Array.isArray(p.required_artifact))errors.push(`${route}:programmatic_artifacts_not_declared`);
   if((p.required_artifact||[]).length>0&&(!clean(p.content_atom_id)||!clean(p.content_atom_uniqueness_key)))errors.push(`${route}:required_artifact_atom_missing`);
 }
 const file=renderedFile(route);
 if(!fs.existsSync(file)){errors.push(`${route}:rendered_file_missing`);continue;}
 const html=fs.readFileSync(file,'utf8');
 if(count(/<h1\b/gi,html)!==1)errors.push(`${route}:h1_count:${count(/<h1\b/gi,html)}`);
 const canon=[...html.matchAll(/<link\b[^>]*>/gi)].map(m=>m[0]).filter(t=>/\brel=["']canonical["']/i.test(t)).map(t=>t.match(/\bhref=["']([^"']+)["']/i)?.[1]).filter(Boolean);
 if(canon.length!==1)errors.push(`${route}:canonical_count:${canon.length}`);
 else {
   const expected=new URL(publicRoute(route),contract.canonical_origin).toString();
   let canonicalOk=canon[0]===expected;
   if(!canonicalOk&&p.page_type==='Medium article'&&p.canonical_domain&&p.canonical_domain!=='theindustryguides.com'){try{canonicalOk=new URL(canon[0]).hostname===p.canonical_domain;}catch{}}
   if(!canonicalOk)errors.push(`${route}:canonical_value:${canon[0]}!=${expected}`);
 }
 if(!/<title>\s*[^<]{3,}\s*<\/title>/i.test(html))errors.push(`${route}:title_missing`);
 const metaDesc=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]).find(t=>/\bname=["']description["']/i.test(t));if(!metaDesc||!(/\bcontent=["'][\s\S]{20,}/i.test(metaDesc)))errors.push(`${route}:meta_description_missing`);
 for(const token of contract.forbidden_unresolved_tokens||[])if(html.includes(token))errors.push(`${route}:unresolved_token:${token}`);
 if(!(contract.sitemap_exempt_paths||[]).includes(route)){
   const expected=new URL(publicRoute(route),contract.canonical_origin).toString();
   if(!sitemap.includes(`<loc>${expected}</loc>`))errors.push(`${route}:sitemap_missing`);
 }
}
if(admission.count!==pages.length)errors.push(`ledger_count_mismatch:${admission.count}/${pages.length}`);
const activeRetirements=(retirements.retirements||[]).filter(r=>r.status==='ACTIVE_301');
const redirectText=fs.existsSync(path.join(ROOT,'_redirects'))?fs.readFileSync(path.join(ROOT,'_redirects'),'utf8'):'';
const admittedPaths=new Set(pages.map(p=>clean(p.path)));
for(const r of activeRetirements){
 const source=clean(r.source_path),target=clean(r.target_path);
 if(!source||!target)errors.push('retirement_missing_path');
 if(admittedPaths.has(source))errors.push(`retired_route_still_admitted:${source}`);
 if(!admittedPaths.has(target))errors.push(`retirement_target_not_admitted:${target}`);
 const linePattern=new RegExp(`^${source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s+${target.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s+301(?:!?)?$`,'m');
 if(!linePattern.test(redirectText))errors.push(`retirement_redirect_missing:${source}`);
}
for(const row of releaseQueue.records||[]){
 if(row.eligible===true && (row.decision!=='SAFE_AUTOPUBLISH'||row.lifecycle_state!=='ADMITTED_FOR_BUILD'))errors.push(`release_queue_invalid_eligible_state:${row.id||row.target_route}`);
 if(row.eligible===true && /STRATEGY_GAP_FILL/i.test(String(row.admission_basis||'')))errors.push(`quota_gap_fill_still_eligible:${row.id||row.target_route}`);
 if(row.eligible===true && String(row.source||'')==='strategy_gap_fill_engine')errors.push(`synthetic_gap_fill_source_still_eligible:${row.id||row.target_route}`);
}
if(pageStrategy.runtime_autonomy!=='FULL_SAFE_AUTONOMY')errors.push('page_strategy_runtime_autonomy_not_full_safe_autonomy');
if(fs.existsSync(activeScopePath))errors.push('active_mutation_scope_present_during_release_validation');
if((frozen.pages||[]).length!==pages.length)errors.push(`frozen_registry_count_mismatch:${(frozen.pages||[]).length}/${pages.length}`);
const historicalBaseline=Number(contract.historical_route_baseline||0);
const effectiveInventory=pages.length+activeRetirements.length;
if(effectiveInventory<historicalBaseline)errors.push(`unexplained_inventory_regression:${pages.length}+${activeRetirements.length}<${historicalBaseline}`);
const report={validator:'page-release-law',status:errors.length?'FAIL':'PASS',inventory_policy:contract.inventory_policy,current_admitted_routes:pages.length,approved_active_retirements:activeRetirements.length,effective_inventory_for_regression:effectiveInventory,historical_route_baseline:historicalBaseline,programmatic_routes:pages.filter(p=>p.programmatic_gate_status===contract.programmatic_gate_value).length,frozen_routes:(frozen.pages||[]).length,error_count:errors.length,warning_count:warnings.length,errors,warnings,checked_at:process.env.SOURCE_DATE||'2026-06-20'};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/page-release-law.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(`PAGE RELEASE LAW FAIL (${errors.length})`);console.error(errors.slice(0,100).join('\n'));process.exit(1);}console.log(`PAGE RELEASE LAW PASS: ${pages.length} dynamically admitted routes.`);
