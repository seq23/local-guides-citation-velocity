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
for(const source of redirects){
  const escaped=source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  if(new RegExp(`<loc>https?://[^<]+${escaped.replace(/\/$/,'/?')}</loc>`).test(sitemapText))errors.push(`redirect_source_in_sitemap:${source}`);
  if(new RegExp(`"path"\\s*:\\s*"${escaped.replace(/\//g,'\\/')}"`).test(admission))errors.push(`redirect_source_admitted:${source}`);
}
const exact=new Map();
for(const page of indexable){
  if(page.text.length<200)continue;
  const hash=crypto.createHash('sha256').update(page.text).digest('hex');
  const list=exact.get(hash)||[];list.push(page.rel);exact.set(hash,list);
}
for(const files of exact.values())if(files.length>1)errors.push(`exact_duplicate_indexable_content:${files.join(',')}`);
const report={validator:'search-quality-basics',ok:errors.length===0,indexable_html_checked:indexable.length,redirect_sources_checked:redirects.size,errors,warnings,policy:{hard_fail:['mojibake','missing indexable title/description/canonical','invalid h1 count','redirect source in sitemap/admission','exact duplicate indexable content without redirect'],non_blocking:['near-duplicate language','marketing-copy preferences','external authority acquisition','citation-volume targets']}};
fs.mkdirSync(path.join(ROOT,'artifacts/validation'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'artifacts/validation/search-quality-basics.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.slice(0,100).join('\n'));process.exit(1);}
console.log(`SEARCH QUALITY BASICS PASS: ${indexable.length} indexable HTML pages; ${redirects.size} redirect sources checked.`);
