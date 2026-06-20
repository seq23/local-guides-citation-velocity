#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'));
const contract=read('data/release/page_release_contract.json');
const admission=read('data/content/page_admission_registry.json');
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
   const expected=new URL(route,contract.canonical_origin).toString();
   let canonicalOk=canon[0]===expected;
   if(!canonicalOk&&p.page_type==='Medium article'&&p.canonical_domain&&p.canonical_domain!=='theindustryguides.com'){try{canonicalOk=new URL(canon[0]).hostname===p.canonical_domain;}catch{}}
   if(!canonicalOk)errors.push(`${route}:canonical_value:${canon[0]}!=${expected}`);
 }
 if(!/<title>\s*[^<]{3,}\s*<\/title>/i.test(html))errors.push(`${route}:title_missing`);
 const metaDesc=[...html.matchAll(/<meta\b[^>]*>/gi)].map(m=>m[0]).find(t=>/\bname=["']description["']/i.test(t));if(!metaDesc||!(/\bcontent=["'][\s\S]{20,}/i.test(metaDesc)))errors.push(`${route}:meta_description_missing`);
 for(const token of contract.forbidden_unresolved_tokens||[])if(html.includes(token))errors.push(`${route}:unresolved_token:${token}`);
 if(!(contract.sitemap_exempt_paths||[]).includes(route)){
   const expected=new URL(route,contract.canonical_origin).toString();
   if(!sitemap.includes(`<loc>${expected}</loc>`))errors.push(`${route}:sitemap_missing`);
 }
}
if(admission.count!==pages.length)errors.push(`ledger_count_mismatch:${admission.count}/${pages.length}`);
if(pages.length<Number(contract.historical_route_floor||0))errors.push(`route_floor_regression:${pages.length}`);
const report={validator:'page-release-law',status:errors.length?'FAIL':'PASS',inventory_policy:contract.inventory_policy,current_admitted_routes:pages.length,historical_route_floor:contract.historical_route_floor,programmatic_routes:pages.filter(p=>p.programmatic_gate_status===contract.programmatic_gate_value).length,error_count:errors.length,warning_count:warnings.length,errors,warnings,checked_at:process.env.SOURCE_DATE||'2026-06-19'};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/page-release-law.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(`PAGE RELEASE LAW FAIL (${errors.length})`);console.error(errors.slice(0,100).join('\n'));process.exit(1);}console.log(`PAGE RELEASE LAW PASS: ${pages.length} dynamically admitted routes.`);
