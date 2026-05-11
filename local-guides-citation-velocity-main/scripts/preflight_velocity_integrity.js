#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const fail = [];

function exists(p){ return fs.existsSync(path.join(ROOT,p)); }
function readJson(p){
  const fp = path.join(ROOT,p);
  if (!fs.existsSync(fp)) { fail.push(`missing ${p}`); return null; }
  try { return JSON.parse(fs.readFileSync(fp,'utf8')); }
  catch(e){ fail.push(`bad JSON ${p}`); return null; }
}
function hasLink(html, href){
  return html.includes(`href="${href}"`) || html.includes(`href='${href}'`);
}
function words(html){
  return html.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;
}

const reg = readJson('content/_shared/query_cluster_registry.json');
const atlas = readJson('content/_shared/atlas_registry.json');
const map = readJson('content/_shared/query_to_cluster_map.json');
const live = readJson('content/_live/pages.json');
const staged = readJson('content/_staged/pages.json');

if (reg && atlas && map) {
  for (const [v,m] of Object.entries(reg)) {
    const clusters = Object.keys(m.clusters||{}).length;
    const queries = map.filter(x=>x.vertical===v).length;
    if (atlas[v].total_clusters !== clusters) fail.push(`${v} cluster mismatch`);
    if (atlas[v].total_queries !== queries) fail.push(`${v} query mismatch`);
  }

  for (const item of map) {
    if (!item.publish_path) continue;
    const f = item.publish_path.replace('/','');
    if (!exists(f)) fail.push(`missing page ${f}`);
    else {
      const html = fs.readFileSync(f,'utf8');
      const cpath = reg[item.vertical]?.clusters[item.cluster]?.path;
      const apath = reg[item.vertical]?.atlas_path;
      if (cpath && !hasLink(html,cpath)) fail.push(`missing cluster link ${f}`);
      if (apath && !hasLink(html,apath)) fail.push(`missing atlas link ${f}`);
      if (!/top/.test(html)) fail.push(`missing top marker ${f}`);
      if (!/bottom/.test(html)) fail.push(`missing bottom marker ${f}`);
      if (words(html) < 120) fail.push(`low words ${f}`);
    }
  }
}

if (live && staged) {
  const l = new Set(live.pages.map(p=>p.slug));
  const s = new Set(staged.pages.map(p=>p.slug));
  for (const x of l) if (!s.has(x)) fail.push(`extra live ${x}`);
  for (const x of s) if (!l.has(x)) fail.push(`missing live ${x}`);
}

if (fail.length){
  console.error("PREFLIGHT FAIL");
  fail.forEach(x=>console.error(x));
  process.exit(1);
}

console.log("PREFLIGHT PASS");
