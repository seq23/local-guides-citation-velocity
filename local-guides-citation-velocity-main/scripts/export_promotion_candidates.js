#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const STAGED_DIR = path.join(ROOT, 'content', '_staged');
const OUT = path.join(ROOT, 'content', '_shared', 'promotion_candidates.json');
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n', 'utf8'); }
const files = fs.readdirSync(STAGED_DIR).filter((n) => /^reddit_queries_.+\.json$/.test(n)).sort();
const items = [];
for (const file of files) {
  const payload = readJson(path.join(STAGED_DIR, file));
  for (const item of payload.items || []) {
    if (item.priority === 'high') items.push({ id: item.id, vertical: item.vertical, cluster: item.cluster, query: item.query, normalized_query: item.normalized_query || item.query, source_bucket: item.source_bucket, promotion_status: 'candidate' });
  }
}
writeJson(OUT, { generated_at: new Date().toISOString(), items });
console.log(`Exported ${items.length} promotion candidates.`);
