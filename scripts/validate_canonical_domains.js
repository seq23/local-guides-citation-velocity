#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const ROOT=path.resolve(__dirname,'..');
const BAD_DOMAINS=[['hormoesivhair','com'].join('.'),['hormoesivehair','com'].join('.')];const SKIP_DIRS=new Set(['.git','node_modules','logs','artifacts']);
function scan(dir){let violations=[];for(const file of fs.readdirSync(dir)){const full=path.join(dir,file);const rel=path.relative(ROOT,full).replace(/\\/g,'/');const stat=fs.statSync(full);if(stat.isDirectory()){if(SKIP_DIRS.has(file))continue;violations=violations.concat(scan(full));}else{if(rel==='scripts/validate_canonical_domains.js')continue;let content;try{content=fs.readFileSync(full,'utf8');}catch{continue;}for(const domain of BAD_DOMAINS)if(content.includes(domain))violations.push({file:rel,domain});}}return violations;}
const violations=scan(ROOT);
// Brand separation (12 Oct 2026): no Spry Labs / West Peek name or domain in dist/
// or Pages Function source, and the lead sender pinned in code. See scripts/lib/brand_separation.js.
const brand=require('./lib/brand_separation').checkBrandSeparation({root:ROOT});
for(const f of brand.failures)violations.push({file:f,domain:'brand-separation'});
// Live canonical routes (16 Oct 2026): every canonical-domain href on a velocity
// insight page must be a route its canonical site publishes - the URL set in
// data/canonical_route_snapshot.json (each canonical sitemap; refresh with
// node scripts/refresh_canonical_route_snapshot.js). ~3,600 insights links had
// pointed at 31 canonical hubs that 404'd. Zero links checked is a failure: a
// scan that found nothing proves nothing.
const canonRoutes=require('./lib/canonical_routes');
const routeCheck={dirs:[],files:0,links_checked:0,dead:[]};
for(const dir of [path.join(ROOT,'insights'),path.join(ROOT,'dist','insights')]){if(!fs.existsSync(dir))continue;routeCheck.dirs.push(path.relative(ROOT,dir));for(const f of fs.readdirSync(dir)){if(!f.endsWith('.html'))continue;routeCheck.files++;const html=fs.readFileSync(path.join(dir,f),'utf8');for(const href of canonRoutes.canonicalHrefs(html)){routeCheck.links_checked++;if(!canonRoutes.isLiveCanonicalRoute(href))routeCheck.dead.push({file:path.relative(ROOT,path.join(dir,f)),href});}}}
if(routeCheck.links_checked===0)violations.push({file:'insights/',domain:'live-canonical-routes: zero canonical links checked'});
const deadByHref={};for(const d of routeCheck.dead){deadByHref[d.href]=(deadByHref[d.href]||0)+1;}
for(const [href,n] of Object.entries(deadByHref))violations.push({file:`${n} insights link(s)`,domain:`live-canonical-routes: ${href} is not in its canonical sitemap snapshot`});
const report={validator:'canonical-domains',status:violations.length?'FAIL':'PASS',ok:violations.length===0,checked_domains:BAD_DOMAINS,brand_separation:{dist_files:brand.distFiles,function_files:brand.functionFiles,sending_files:brand.sendingFiles,workflow_files:brand.workflowFiles,failures:brand.failures},violations,live_canonical_routes:{snapshot_generated_at:canonRoutes.loadSnapshot().generated_at,dirs:routeCheck.dirs,files:routeCheck.files,links_checked:routeCheck.links_checked,dead_links:routeCheck.dead.length,dead_hrefs:deadByHref}};fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});fs.writeFileSync(path.join(ROOT,'artifacts/validation/canonical-domains.json'),JSON.stringify(report,null,2)+'\n');if(violations.length){console.error('BAD CANONICAL DOMAIN FOUND');for(const r of violations)console.error(`${r.domain} in ${r.file}`);process.exit(1);}console.log(`Canonical domains clean; ${routeCheck.links_checked} canonical links in ${routeCheck.files} insight files all live routes; brand separation: ${brand.distFiles} dist files + ${brand.functionFiles} function files clean, lead sender pinned; ${brand.sendingFiles} sending files + ${brand.workflowFiles} workflows carry no West Peek or Spry sender`);
