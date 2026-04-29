#!/usr/bin/env node
'use strict';
const {readJson,writeJsonChecked}=require('../lib/llm_utils');
const candidates=readJson('data/lkg_candidates/latest.json',{candidates:[]});
const scored=readJson('data/community/scored_clusters.json',[]);
writeJsonChecked('data/community/index_manifest.json', {
  generated_at:new Date().toISOString(),
  mode:'velocity_signal_to_lkg_candidate_index',
  scored_cluster_count:Array.isArray(scored)?scored.length:0,
  lkg_candidate_count:Array.isArray(candidates.candidates)?candidates.candidates.length:0,
  candidates_path:'data/lkg_candidates/latest.json'
});
console.log('Community LKG candidate index updated');
