#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=(rel)=>JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));
const publishedInventory=read('content/_live/published_urls.json').items;
const livePages=read('content/_live/pages.json').pages;

// ---------------------------------------------------------------- the loop
// This registry was a fixed point that no new page could enter.
//
// It is built from content/_live/published_urls.json. published_urls.json is
// written by scripts/build_site.js from `allUrls`, which is `written` filtered
// through isPubliclyAdmitted, which asks this registry. So a route was admitted
// if it was published, and published if it was admitted: a page released after
// the 2026-06-19 baseline could be promoted to live with publication_status
// ADMITTED, rendered to disk as an indexable page, and still never reach a
// sitemap, a feed or an llms export, because nothing could put it into the set
// that decides those. That is exactly the shape of the 11 rendered-but-
// unsubmitted routes found on 2026-08-29, and it would have swallowed every
// page the newly-wired backlog drain builds.
//
// The loop is broken by admitting what the release lane actually released. A
// route joins the registry when all four of these hold:
//
//   * it is a page record in content/_live/pages.json - it went through the
//     release law and the staged-to-live promotion, not just onto disk;
//   * its publication_status is ADMITTED - EVIDENCE_ONLY is the declared way to
//     hold a page back, and retirement sets it;
//   * it is rendered on disk - a record with no page is not a public route;
//   * it is not a 301 source in _redirects - a retired route is a named stop.
//
// At the moment this was written that rule admitted exactly the routes the
// parity walk had found orphaned and nothing else, which is the check that it
// is a fix rather than a widening. scripts/validators/validate_admission_
// reachability.js re-runs the same rule on every validation and hard-fails if a
// released page is unreachable again.
const REDIRECT_SOURCES=(()=>{ const s=new Set(); try{ for(const line of fs.readFileSync(path.join(ROOT,'_redirects'),'utf8').split('\n')){ const t=line.trim(); if(!t||t.startsWith('#'))continue; const from=t.split(/\s+/)[0]; if(from&&from.startsWith('/'))s.add(from.replace(/\/+$/,'/')); } }catch{} return s; })();
const isRedirected=(route)=>{ const r=String(route||''); return REDIRECT_SOURCES.has(r)||REDIRECT_SOURCES.has(r.replace(/\/+$/,'/'))||REDIRECT_SOURCES.has(r.endsWith('.html')?r.slice(0,-5):`${r}.html`); };
const isRendered=(route)=>{ const rel=String(route||'').replace(/^\/+|\/+$/g,''); if(!rel)return true; return fs.existsSync(path.join(ROOT,rel,'index.html'))||fs.existsSync(path.join(ROOT,`${rel}.html`)); };
const publishedPaths=new Set(publishedInventory.map((x)=>x.path));
const releasedButUnadvertised=livePages
  .map((p)=>({route:p.slug||p.path,page:p}))
  .filter(({route,page})=>route
    && !publishedPaths.has(route)
    && String(page.publication_status||'').toUpperCase()==='ADMITTED'
    && !isRedirected(route)
    && isRendered(route))
  .map(({route,page})=>({url:`https://theindustryguides.com${route}`,path:route,lastmod:page.date_modified||null,surface:'page',canonical_domain:'theindustryguides.com'}));
if(releasedButUnadvertised.length)console.log(`PAGE ADMISSION REGISTRY: admitting ${releasedButUnadvertised.length} released route(s) that the published-URL inventory does not yet name`);
const published=[...publishedInventory,...releasedButUnadvertised];
const insights=read('content/_live/insights.json').items;
const medium=read('content/_live/medium_articles.json').items;
const recommendations=read('data/citation_velocity/recommendations.json').recommendations;
const wins=read('data/citation_velocity/wins.json').wins;
const previous=fs.existsSync(path.join(ROOT,'data/content/page_admission_registry.json'))?read('data/content/page_admission_registry.json').pages:[];
const previousByPath=new Map(previous.map(x=>[x.path,x]));
const liveByPath=new Map(); for(const x of livePages){if(x.slug)liveByPath.set(x.slug,x);if(x.path)liveByPath.set(x.path,x);}
const insightByPath=new Map(insights.map(x=>[x.publish_path,x]));
const mediumByPath=new Map(medium.map(x=>[x.publish_path,x]));
const normalizePath=(v)=>String(v||'');
const recByPage=new Map();
for(const r of recommendations){const key=normalizePath(r.page);if(!recByPage.has(key))recByPage.set(key,[]);recByPage.get(key).push(r.id);}
const winByPage=new Map();
for(const w of wins){for(const page of (w.pages||[w.page]).filter(Boolean)){const key=normalizePath(page);if(!winByPage.has(key))winByPage.set(key,[]);winByPage.get(key).push(w.id);}}
function pageType(item){const p=item.path;if(['/personal-injury/','/dentistry/','/trt/','/neuro/','/uscis-medical/'].includes(p))return 'Vertical hub';if(p.startsWith('/insights/')&&p!=='/insights/')return 'Insight';if(p.startsWith('/medium-articles/'))return 'Medium article';if(p.startsWith('/atlas/'))return 'Atlas';if(liveByPath.has(p))return 'Canonical guide';return 'Global page';}
function verticalFor(p,source){if(source?.vertical)return source.vertical==='personal_injury'?'personal-injury':source.vertical;for(const v of ['personal-injury','dentistry','trt','neuro','uscis-medical'])if(p.includes(`/${v}/`)||p.startsWith(`${v}-`)||p.includes(`/${v}-`))return v;return 'global';}
function sensitivity(source){if(source?.sensitivity_profile)return source.sensitivity_profile;const d=String(source?.disclaimer||'').toLowerCase();if(d.includes('legal')&&d.includes('medical'))return 'legal-medical';if(d.includes('legal'))return 'legal';if(d.includes('medical'))return 'medical';return 'general';}
const pages=published.map(item=>{
  const p=item.path;
  const live=liveByPath.get(p);
  const insight=insightByPath.get(p);
  const med=mediumByPath.get(p);
  const source=live||insight||med||null;
  const prev=previousByPath.get(p)||{};
  const type=pageType(item);
  const sourceFile=live?'content/_live/pages.json':insight?'content/_live/pages.json + content/_live/insights.json':med?(med.source_path||`medium-articles/${med.source_vertical}/${med.slug}/`):(type==='Atlas'?'content/_shared/query_cluster_registry.json':'scripts/build_site.js');
  const generator=(type==='Insight'||type==='Medium article')?'scripts/lib/publish_contract.js':'scripts/build_site.js';
  const artifacts=source?.citation_velocity_artifacts||[];
  const requiredSources=(source?.source_records||[]).map(x=>typeof x==='string'?x:x.url).filter(Boolean);
  return {
    path:p,
    vertical:verticalFor(p,source),
    page_type:type,
    primary_query:source?.title||prev.primary_query||p,
    source_owner:live||med?'VELOCITY_CONTENT':'VELOCITY_GENERATOR',
    source_file:sourceFile,
    generator,
    required_framework:artifacts.find(x=>x.type==='numbered_framework')?.title||prev.required_framework||null,
    required_artifact:artifacts.map(x=>x.type).filter(Boolean),
    required_sources:requiredSources,
    sensitivity_profile:sensitivity(source),
    canonical_domain:item.canonical_domain||'theindustryguides.com',
    schema_profile:prev.schema_profile||((type==='Insight'||live)?'Article+FAQPage+HowTo+BreadcrumbList':'WebPage'),
    programmatic_gate_status:(type==='Insight'||live)?'ADMITTED':'NOT_APPLICABLE',
    content_atom_type:source?.content_atom?.type||null,
    content_atom_id:source?.content_atom?.atom_id||null,
    content_atom_uniqueness_key:source?.content_atom?.uniqueness_key||null,
    monitor_recommendation_ids:[...new Set([...(recByPage.get(p)||[]),...(prev.monitor_recommendation_ids||[])])],
    win_ids:[...new Set([...(winByPage.get(p)||[]),...(prev.win_ids||[])])],
    publication_status:'ADMITTED',
    admission_basis:(type==='Insight'||live)?'PROGRAMMATIC_CONTENT_GATE_V1':'BASELINE_PUBLIC_ROUTE_2026-06-19',
    lastmod:item.lastmod
  };
});
if(new Set(pages.map(x=>x.path)).size!==pages.length)throw new Error('Published route inventory contains duplicate paths');
const out={schema_version:'1.2',baseline_date:'2026-06-19',count:pages.length,pages};
fs.mkdirSync(path.join(ROOT,'data/content'),{recursive:true});
fs.writeFileSync(path.join(ROOT,'data/content/page_admission_registry.json'),JSON.stringify(out,null,2)+'\n');
console.log(`PAGE ADMISSION REGISTRY BUILT (${pages.length} routes)`);
