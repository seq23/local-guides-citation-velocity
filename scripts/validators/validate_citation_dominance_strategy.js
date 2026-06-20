#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const p=rel=>path.join(ROOT,rel), exists=rel=>fs.existsSync(p(rel)), read=rel=>fs.readFileSync(p(rel),'utf8'), json=rel=>JSON.parse(read(rel));
const contract=json('data/strategy/citation_dominance_contract.json');
const gaps=json('data/strategy/citation_dominance_gap_registry.json');
const required=[
  'about.html','methodology.html','robots.txt','sitemap.xml','llms.txt','llms-full.txt',
  'data/evidence/source_registry.json','data/evidence/claim_registry.json','data/evidence/state_source_registry.json',
  'data/content/page_admission_registry.json','data/providers/provider_substrate_contract.json','data/providers/provider_registry.json',
  'data/authority/reviewer_registry.json','data/authority/verified_same_as_registry.json','data/strategy/citation_dominance_gap_registry.json'
];
const errors=[],warnings=[];
for(const rel of required)if(!exists(rel))errors.push(`missing:${rel}`);
const about=exists('about.html')?read('about.html'):'', methodology=exists('methodology.html')?read('methodology.html'):'', robots=exists('robots.txt')?read('robots.txt'):'', llms=exists('llms.txt')?read('llms.txt'):'', full=exists('llms-full.txt')?read('llms-full.txt'):'';
if(!/data-editorial-identity=["']true["']/i.test(about))errors.push('missing_truthful_editorial_identity_block');
for(const layer of ['substrate','reference','authority','distribution'])if(!methodology.includes(`data-methodology-layer="${layer}"`))errors.push(`missing_methodology_layer:${layer}`);
function crawlerAllowed(agent){const escaped=agent.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');const block=(robots.match(new RegExp(`User-agent:\\s*${escaped}([\\s\\S]*?)(?=\\nUser-agent:|$)`,'i'))||[])[1]||'';return block&&!/Disallow:\s*\/\s*$/mi.test(block);}
for(const agent of ['Googlebot','Bingbot','OAI-SearchBot'])if(!crawlerAllowed(agent))errors.push(`search_crawler_not_allowed:${agent}`);
if(llms.trim().length<100)warnings.push('llms_surface_thin_or_missing');
if(full.trim().length<500)warnings.push('llms_full_index_thin_or_missing');
const sources=exists('data/evidence/source_registry.json')?(json('data/evidence/source_registry.json').sources||[]):[];
const claims=exists('data/evidence/claim_registry.json')?(json('data/evidence/claim_registry.json').claims||[]):[];
const states=exists('data/evidence/state_source_registry.json')?(json('data/evidence/state_source_registry.json').states||[]):[];
const admission=exists('data/content/page_admission_registry.json')?(json('data/content/page_admission_registry.json').pages||[]):[];
const providers=exists('data/providers/provider_registry.json')?(json('data/providers/provider_registry.json').records||[]):[];
const reviewers=exists('data/authority/reviewer_registry.json')?(json('data/authority/reviewer_registry.json').reviewers||[]):[];
const sameAs=exists('data/authority/verified_same_as_registry.json')?(json('data/authority/verified_same_as_registry.json').records||[]):[];
const active=admission.filter(x=>!x.publication_status||x.publication_status==='ADMITTED'||x.publication_status==='LIVE');
const byType={};for(const page of active)byType[page.page_type||'unknown']=(byType[page.page_type||'unknown']||0)+1;
function fileFor(route){if(route==='/')return p('index.html');if(route.endsWith('.html'))return p(route.replace(/^\//,''));return p(route.replace(/^\//,'').replace(/\/$/,'' )+'/index.html');}
function canonicalFrom(html){return (html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)||html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)||[])[1]||'';}
const reference={checked:0,one_h1:0,self_canonical:0,direct_answer:0,date_modified_schema:0,visible_review_date:0,organization_schema:0,visible_editorial_byline:0,internal_links:0};
const bridges={checked:0,by_canonical_domain:{},routes:[]};
for(const page of active){
  const file=fileFor(page.path);if(!fs.existsSync(file))continue;
  const html=fs.readFileSync(file,'utf8');const canonical=canonicalFrom(html);
  if(!canonical.startsWith('https://theindustryguides.com/')){
    bridges.checked++;let domain='missing';try{domain=new URL(canonical).hostname||'missing';}catch{}bridges.by_canonical_domain[domain]=(bridges.by_canonical_domain[domain]||0)+1;bridges.routes.push({path:page.path,canonical});continue;
  }
  reference.checked++;
  if((html.match(/<h1\b/gi)||[]).length===1)reference.one_h1++;
  const expected='https://theindustryguides.com'+page.path;if(canonical===expected||canonical===expected.replace(/\/$/,''))reference.self_canonical++;
  if(/data-direct-answer=["']true["']|class=["'][^"']*answer-box/.test(html))reference.direct_answer++;
  if(/"dateModified"\s*:/.test(html))reference.date_modified_schema++;
  if(/data-review-date=["']true["']/.test(html))reference.visible_review_date++;
  if(html.includes('https://theindustryguides.com/#organization'))reference.organization_schema++;
  if(/data-editorial-byline=["']true["']/.test(html))reference.visible_editorial_byline++;
  if((html.match(/<a\b[^>]*href=["']\//gi)||[]).length>=2)reference.internal_links++;
}
const verifiedProviders=providers.filter(x=>x.status==='VERIFIED').length, verifiedReviewers=reviewers.filter(x=>x.status==='VERIFIED').length, verifiedSameAs=sameAs.filter(x=>x.status==='VERIFIED').length;
if(!verifiedProviders)warnings.push('provider_substrate_infrastructure_ready_but_no_verified_records');
if(!verifiedReviewers)warnings.push('organizational_byline_active_no_verified_individual_reviewers');
if(!verifiedSameAs)warnings.push('no_verified_sameAs_profiles_supplied');
const report={
  validator:'citation-dominance-strategy',status:errors.length?'FAIL':'PASS_WITH_TRUTHFUL_EXTERNAL_GAPS',errors,warnings,scope_decision:contract.operating_model,
  layers:{
    substrate:{status:verifiedProviders?'IMPLEMENTED_WITH_VERIFIED_PROVIDER_DATA':'PARTIAL_STRONG_INFRASTRUCTURE_READY',source_records:sources.length,claim_records:claims.length,state_records:states.length,verified_provider_records:verifiedProviders,provider_registry:'data/providers/provider_registry.json'},
    reference_pages:{status:'IMPLEMENTED',self_canonical_reference_routes:reference.checked,page_types:byType,rendered_conformance:reference},
    authority:{status:verifiedReviewers?'IMPLEMENTED_WITH_VERIFIED_REVIEWERS':'PARTIAL_TRUTHFUL_ORGANIZATIONAL_BYLINE',verified_reviewer_records:verifiedReviewers,verified_sameAs_records:verifiedSameAs,visible_bylines:reference.visible_editorial_byline,methodology:true,source_provenance:true},
    distribution:{status:'IMPLEMENTED_IN_REPO_EXTERNAL_MEASUREMENT_PENDING',syndication_bridge_routes:bridges,robots:true,sitemap:true,llms_txt:llms.trim().length>0,llms_full_txt:full.trim().length>0,server_rendered_routes:active.length}
  },
  interpretation:'External-canonical Medium articles are distribution bridges and are not counted as self-canonical TheIndustryGuides reference pages.',
  external_gap_registry:gaps.items,current_platform_reconciliation:contract.current_platform_reconciliation,
  anti_fabrication:'No reviewer, provider, credential, license, fee, ranking, or availability record may be invented to satisfy the strategy.'
};
fs.mkdirSync(p('artifacts/validation'),{recursive:true});fs.writeFileSync(p('artifacts/validation/citation-dominance-strategy.json'),JSON.stringify(report,null,2)+'\n');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Citation dominance strategy alignment PASS WITH TRUTHFUL EXTERNAL GAPS: ${reference.checked} self-canonical reference routes, ${bridges.checked} distribution bridges, ${sources.length} sources, ${claims.length} claims.`);
