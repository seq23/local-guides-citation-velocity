#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const verticals = ['dentistry', 'neuro', 'trt', 'uscis-medical', 'personal-injury'];
const patterns = verticals.map(v => `${v}-${v}-`);
const issues = [];
function fullPath(rel){ return path.join(ROOT, rel); }
function readTextSafe(rel){ const full = fullPath(rel); if(!fs.existsSync(full)) return ''; try { return fs.readFileSync(full,'utf8'); } catch { return ''; } }
function scanFile(relPath){ const text = readTextSafe(relPath); if(!text) return; for(const pat of patterns){ if(text.includes(pat)) issues.push({file: relPath, pattern: pat}); } }
function walk(dirRel){ const full = fullPath(dirRel); if(!fs.existsSync(full)) return; for(const name of fs.readdirSync(full)){ const rel = path.join(dirRel,name); const abs = fullPath(rel); let stat; try { stat = fs.statSync(abs); } catch { continue; } if(stat.isDirectory()) walk(rel); else if(/\.(json|xml|txt|html|js|md)$/.test(name)) scanFile(rel); } }
['content/_shared/query_to_cluster_map.json','content/_shared/atlas_registry.json','content/_live/insights.json','content/_live/published_urls.json','sitemap.xml','llms.txt'].forEach(scanFile);
walk('insights'); walk('atlas'); walk('dist');
if(issues.length){ console.error('DOUBLE VERTICAL SLUG VALIDATION FAIL'); for(const issue of issues.slice(0,100)) console.error(`- ${issue.file}: contains "${issue.pattern}"`); if(issues.length>100) console.error(`...and ${issues.length-100} more`); process.exit(1); }
console.log('Double vertical slug validation passed.');
