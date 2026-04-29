#!/usr/bin/env node
'use strict';
const {readJson,writeJsonChecked,slugify}=require('./lib/llm_utils');
const clusters=readJson('content/_shared/query_cluster_registry.json',{});
const qmap=readJson('content/_shared/query_to_cluster_map.json',{});
const atlas=readJson('content/_shared/atlas_registry.json',{});
const entities=[]; const concepts=[]; const edges=[];
for(const [id,c] of Object.entries(clusters)){
  const vertical=c.vertical||c.verticalKey||c.category||'unknown';
  concepts.push({id:`concept:${id}`, name:c.name||c.title||id, vertical, source:'query_cluster_registry'});
}
for(const [id,a] of Object.entries(atlas)){
  const name=a.name||a.title||id; const eid=`entity:${slugify(name)}`;
  entities.push({id:eid, name, vertical:a.vertical||a.verticalKey||null, source:'atlas_registry'});
  if(a.cluster||a.clusterId) edges.push({from:eid, to:`concept:${a.cluster||a.clusterId}`, type:'atlas_cluster'});
}
for(const [query,raw] of Object.entries(qmap)){
  const cid=typeof raw==='string'?raw:(raw.cluster||raw.clusterId||raw.id||raw.targetCluster);
  if(cid) edges.push({from:`query:${slugify(query)}`, to:`concept:${cid}`, type:'query_maps_to_concept'});
}
if(!concepts.length) throw new Error('No concepts derived; refusing to write entity graph');
writeJsonChecked('content/_shared/entity_registry.json', entities);
writeJsonChecked('content/_shared/concept_registry.json', concepts);
writeJsonChecked('dist/llm/entity_graph.json', {generated_at:new Date().toISOString(), entities, concepts, edges});
console.log(`Entity graph built: ${entities.length} entities, ${concepts.length} concepts`);
