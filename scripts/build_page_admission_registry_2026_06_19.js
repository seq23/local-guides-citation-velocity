#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=(rel)=>JSON.parse(fs.readFileSync(path.join(ROOT,rel),'utf8'));
const published=read('content/_live/published_urls.json').items;
const livePages=read('content/_live/pages.json').pages;
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
