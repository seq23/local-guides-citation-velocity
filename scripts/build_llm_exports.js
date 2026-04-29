#!/usr/bin/env node
'use strict';
const {readJson,writeJsonChecked,entries,titleOf,urlOf,slugify}=require('./lib/llm_utils');
const clusters=readJson('content/_shared/query_cluster_registry.json',{});
const qmap=readJson('content/_shared/query_to_cluster_map.json',{});
const atlas=readJson('content/_shared/atlas_registry.json',{});
const pages=readJson('content/_live/pages.json',{});
const insights=readJson('content/_live/insights.json',{});
if(!Object.keys(qmap).length) throw new Error('Missing query_to_cluster_map.json or it is empty');
const pageRows=entries(pages).map(([id,p])=>({id, title:titleOf(p), url:urlOf(p), vertical:p.vertical||p.verticalKey||p.category||null, cluster:p.cluster||p.clusterId||null}));
const insightRows=entries(insights).map(([id,p])=>({id, title:titleOf(p), url:urlOf(p), vertical:p.vertical||p.verticalKey||p.category||null, cluster:p.cluster||p.clusterId||null}));
const queryCoverage=[];
const metadata=[];
for(const [query, raw] of Object.entries(qmap)){
  const clusterId = typeof raw==='string' ? raw : raw.cluster || raw.clusterId || raw.id || raw.targetCluster || null;
  const vertical = raw.vertical || raw.verticalKey || (clusters[clusterId] && (clusters[clusterId].vertical||clusters[clusterId].verticalKey)) || null;
  const slug = slugify(query);
  const matches = [...pageRows,...insightRows].filter(p => (clusterId && p.cluster===clusterId) || slugify(p.title).includes(slug.slice(0,40)) || slugify(p.url).includes(slug.slice(0,40)));
  queryCoverage.push({query, clusterId, vertical, matched_urls:[...new Set(matches.map(m=>m.url).filter(Boolean))].slice(0,10)});
  metadata.push({query, query_slug:slug, clusterId, vertical, has_page_match:matches.length>0});
}
const coverage={generated_at:new Date().toISOString(), totals:{queries:Object.keys(qmap).length, clusters:Object.keys(clusters).length, atlas_entries:Object.keys(atlas).length, live_pages:pageRows.length, live_insights:insightRows.length, queries_with_matches:queryCoverage.filter(x=>x.matched_urls.length).length}, verticals:{}};
for(const row of queryCoverage){ const v=row.vertical||'unknown'; coverage.verticals[v] ||= {queries:0, matched:0}; coverage.verticals[v].queries++; if(row.matched_urls.length) coverage.verticals[v].matched++; }
const answers=queryCoverage.map(r=>({query:r.query, clusterId:r.clusterId, vertical:r.vertical, preferred_urls:r.matched_urls, answer_surface:r.matched_urls.length?'live_or_insight':'unmatched'}));
const graph={generated_at:new Date().toISOString(), nodes:{clusters:Object.keys(clusters), atlas:Object.keys(atlas), pages:pageRows.map(p=>p.id), insights:insightRows.map(p=>p.id)}, edges:queryCoverage.map(r=>({from:`query:${slugify(r.query)}`, to:r.clusterId?`cluster:${r.clusterId}`:null, urls:r.matched_urls})).filter(e=>e.to)};
writeJsonChecked('dist/llm/answers.json', answers);
writeJsonChecked('dist/llm/coverage.json', coverage);
writeJsonChecked('dist/llm/query_coverage_map.json', queryCoverage);
writeJsonChecked('dist/llm/query_metadata.json', metadata);
writeJsonChecked('dist/llm/internal_authority_graph.json', graph);
console.log(`LLM exports built for ${Object.keys(qmap).length} queries`);
