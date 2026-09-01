#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..');
const norm=(p)=>p.replace(/\\/g,'/');
function walk(dir,out=[]){if(!fs.existsSync(dir))return out;for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory()){if(!['node_modules','.git','dist','reports','artifacts'].includes(ent.name))walk(p,out);}else out.push(p);}return out;}
function strip(html){return html.replace(/<script\b[\s\S]*?<\/script>/gi,' ').replace(/<style\b[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&[a-z0-9#]+;/gi,' ').replace(/\s+/g,' ').trim();}
function attrTag(html,tag,attr,value){const tags=html.match(new RegExp(`<${tag}\\b[^>]*>`,'gi'))||[];return tags.find(t=>new RegExp(`\\b${attr}=(["'])${value}\\1`,'i').test(t))||'';}
function attr(tag,name){const m=tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`,'i'));return m?m[2].trim():'';}
const redirectText=fs.existsSync(path.join(ROOT,'_redirects'))?fs.readFileSync(path.join(ROOT,'_redirects'),'utf8'):'';
const redirects=new Set(redirectText.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#')).map(x=>x.split(/\s+/)[0]).filter(x=>x&&x.startsWith('/')));
const sitemapText=['sitemap.xml',...(fs.existsSync(path.join(ROOT,'sitemaps'))?walk(path.join(ROOT,'sitemaps')).filter(x=>x.endsWith('.xml')).map(x=>norm(path.relative(ROOT,x))):[])].filter(rel=>fs.existsSync(path.join(ROOT,rel))).map(rel=>fs.readFileSync(path.join(ROOT,rel),'utf8')).join('\n');
const admission=fs.existsSync(path.join(ROOT,'data/content/page_admission_registry.json'))?fs.readFileSync(path.join(ROOT,'data/content/page_admission_registry.json'),'utf8'):'';
const errors=[],warnings=[],indexable=[];
// ------------------------------------------------------------------- Rule 0
// What this used to do, and why that was wrong
// --------------------------------------------
// walk() below sweeps the repo for .html and grades whatever it finds. On the
// real tree that is 2166 indexable pages. On a truncated or half-checked-out
// tree it found 6, printed "SEARCH QUALITY BASICS PASS: 6 indexable HTML pages"
// and exited 0 - reproduced verbatim in a sandbox. Every page that was not there
// was silently counted as compliant: the same green line covers "2166 pages all
// carry a title, description, canonical and one h1" and "I could see six files".
// Titles, canonicals and duplicate detection are exactly the checks that a
// truncated tree makes look perfect, because absence is indistinguishable from
// compliance when nothing counts what was examined.
//
// The fix is a FLOOR, not a loosened assertion. The counts below were measured
// on the real tree on 2026-08-29 (`node scripts/validators/validate_search_quality_basics.js`
// reported "2166 indexable HTML pages; 193 redirect sources checked"). MIN_* are
// set below the measured values so ordinary publishing churn does not trip them,
// but far above what a truncated tree exposes. Changing them must be deliberate:
// re-measure by running this validator and reading the counts it prints.
const MEASURED_INDEXABLE_2026_08_29=2166;
const MIN_INDEXABLE_PAGES=1900;
const MEASURED_REDIRECT_SOURCES_2026_08_29=193;
const MIN_REDIRECT_SOURCES=150;
const stops=[];
if(!redirectText.trim())stops.push('_redirects is missing or empty, so the redirect-source checks below (redirect in sitemap, redirect source admitted) examined nothing.');
if(!sitemapText.trim())stops.push('no sitemap XML could be read (sitemap.xml and sitemaps/ are both absent or empty), so no redirect source could be tested against a sitemap.');
const badEncoding=/â(?:|€™|€œ|€|€˜|€")|Ã¢|Â(?=[^A-Za-z]|$)/;
for(const abs of walk(ROOT).filter(p=>p.endsWith('.html'))){
  const rel=norm(path.relative(ROOT,abs));
  if(rel==='404.html'||rel.startsWith('templates/')||rel.startsWith('data/report_fixes/agent_runs/'))continue;
  const html=fs.readFileSync(abs,'utf8');
  if(badEncoding.test(html))errors.push(`${rel}:mojibake`);
  const noindex=/<meta\b[^>]*name=(["'])robots\1[^>]*content=(["'])[^"']*noindex/i.test(html)||/<meta\b[^>]*content=(["'])[^"']*noindex[^"']*\1[^>]*name=(["'])robots\2/i.test(html);
  const route='/' + rel.replace(/index\.html$/,'').replace(/^index\.html$/,'');
  const routeNorm=route==='/'?'/':route.replace(/\/+$/,'/')
  if(noindex||redirects.has(routeNorm)||redirects.has(routeNorm.replace(/\/$/,'')))continue;
  const title=(html.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||'';
  const descTag=attrTag(html,'meta','name','description');
  const canonicalTag=attrTag(html,'link','rel','canonical');
  const h1=(html.match(/<h1\b[^>]*>/gi)||[]).length;
  const canonical=attr(canonicalTag,'href');
  if(!title.trim())errors.push(`${rel}:missing_title`);
  if(!attr(descTag,'content'))errors.push(`${rel}:missing_meta_description`);
  if(!canonical)errors.push(`${rel}:missing_canonical`);
  if(h1!==1)errors.push(`${rel}:h1_count_${h1}`);
  indexable.push({rel,route:routeNorm,canonical,text:strip(html)});
}
// The loc PATH has to equal the redirect source, not merely end with it.
//
// `[^<]+` used to swallow any number of leading path segments, so the redirect source
// /neuro-033-adult-specialist-anxiety-vs-adhd-eval-near-me/ matched the sitemap entry
// for /insights/neuro-033-adult-specialist-anxiety-vs-adhd-eval-near-me - a different
// URL, correctly advertised, and the only one of the two that exists. Three legitimate
// agent-URL aliases turned this validator amber on 2026-09-01 for URLs the sitemap does
// not contain. The host is matched explicitly and the path is anchored, so an alias only
// trips this when the sitemap really does advertise the address being redirected away.
const sitemapPaths=new Set();
for(const m of sitemapText.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)){
  let loc=m[1].replace(/^https?:\/\/[^/]+/,'').replace(/[?#].*$/,'');
  if(!loc.startsWith('/'))loc=`/${loc}`;
  sitemapPaths.add(loc);
  sitemapPaths.add(loc.endsWith('/')?loc.slice(0,-1):`${loc}/`);
}
for(const source of redirects){
  const escaped=source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(sitemapPaths.has(source))errors.push(`redirect_source_in_sitemap:${source}`);
  if(new RegExp(`"path"\\s*:\\s*"${escaped.replace(/\//g,'\\/')}"`).test(admission))errors.push(`redirect_source_admitted:${source}`);
}
const exact=new Map();
for(const page of indexable){
  if(page.text.length<200)continue;
  const hash=crypto.createHash('sha256').update(page.text).digest('hex');
  const list=exact.get(hash)||[];list.push(page.rel);exact.set(hash,list);
}
for(const files of exact.values())if(files.length>1)errors.push(`exact_duplicate_indexable_content:${files.join(',')}`);
if(indexable.length<MIN_INDEXABLE_PAGES)stops.push(`only ${indexable.length} indexable HTML page(s) found; expected at least ${MIN_INDEXABLE_PAGES} (the real tree measured ${MEASURED_INDEXABLE_2026_08_29} on 2026-08-29). The tree is unbuilt or truncated, so this check graded almost nothing.`);
if(redirects.size<MIN_REDIRECT_SOURCES)stops.push(`only ${redirects.size} redirect source(s) read from _redirects; expected at least ${MIN_REDIRECT_SOURCES} (measured ${MEASURED_REDIRECT_SOURCES_2026_08_29} on 2026-08-29).`);
if(stops.length){
  fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
  fs.writeFileSync(path.join(ROOT,'artifacts/validation/search-quality-basics.json'),JSON.stringify({validator:'search-quality-basics',ok:false,status:'UNVERIFIED_TREE_TRUNCATED',indexable_html_checked:indexable.length,redirect_sources_checked:redirects.size,expected_indexable_minimum:MIN_INDEXABLE_PAGES,stops},null,2)+'\n');
  console.error('SEARCH QUALITY BASICS: STOP - the tree this ran against is not the site, so no search-quality claim can be made.');
  for(const s of stops)console.error(`- ${s}`);
  console.error('  Remedy: run against a complete checkout (and build it if the lane requires dist/), then re-run. A page that is absent is not a page that passed.');
  process.exit(1);
}
const report={validator:'search-quality-basics',ok:errors.length===0,indexable_html_checked:indexable.length,redirect_sources_checked:redirects.size,errors,warnings,policy:{hard_fail:['mojibake','missing indexable title/description/canonical','invalid h1 count','redirect source in sitemap/admission','exact duplicate indexable content without redirect'],non_blocking:['near-duplicate language','marketing-copy preferences','external authority acquisition','citation-volume targets']}};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/search-quality-basics.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.slice(0,100).join('\n'));process.exit(1);}
console.log(`SEARCH QUALITY BASICS PASS: ${indexable.length} indexable HTML pages; ${redirects.size} redirect sources checked.`);
