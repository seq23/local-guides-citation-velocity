#!/usr/bin/env node
'use strict';
const fs=require('fs');
const required=['data/community/clusters.json','data/community/scored_clusters.json','data/community/index_manifest.json','data/lkg_candidates/latest.json'];
const optional=['data/community/collection_status.json','data/community/raw_signals.json','data/community/normalized_signals.json','data/community/mapped_signals.json'];
const missing=required.filter(f=>!fs.existsSync(f));
if(missing.length){console.error('Missing social/LKG candidate loop outputs:\n'+missing.join('\n'));process.exit(1)}
for(const f of required) JSON.parse(fs.readFileSync(f,'utf8'));
for(const f of optional) if(fs.existsSync(f)) JSON.parse(fs.readFileSync(f,'utf8'));
const scored=JSON.parse(fs.readFileSync('data/community/scored_clusters.json','utf8'));
if(!Array.isArray(scored)) { console.error('scored_clusters.json must be an array'); process.exit(1); }
const bad=scored.filter(c=>['high','review'].includes(c.publish_priority) && !c.vertical);
if(bad.length){ console.error('High/review-priority social clusters missing vertical mapping'); process.exit(1); }
const candidates=JSON.parse(fs.readFileSync('data/lkg_candidates/latest.json','utf8'));
if(candidates.source_repo_role !== 'velocity_signal_detection_only') { console.error('LKG candidate export must preserve Velocity as signal-only source'); process.exit(1); }
console.log('Social signal to LKG candidate loop OK');
