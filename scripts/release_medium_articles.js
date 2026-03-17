#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const STATE = path.join(ROOT, 'content', '_shared', 'release_state.json');
const LIVE = path.join(ROOT, 'content', '_live', 'medium_articles.json');
function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeJson(p, o){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(o, null, 2)+'
','utf8'); }
function walk(dir){
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})){
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
function scan(){
  const dir = path.join(ROOT, 'medium-articles');
  return walk(dir)
    .filter(fp=>fp.endsWith(path.sep+'index.html') || fp.endsWith('/index.html'))
    .map(fp=>path.relative(ROOT, fp).replace(/\/g,'/').replace(/\/index\.html$/,'/'))
    .sort();
}
function main(){
  const batchSize = Number(process.argv[2] || 1);
  const all = scan();
  const state = fs.existsSync(STATE) ? readJson(STATE) : {};
  const start = Number(state.released_medium_articles || 0);
  const end = Math.min(all.length, start + batchSize);
  state.released_medium_articles = end;
  writeJson(STATE, state);
  writeJson(LIVE, { released_count: end, total: all.length, items: all.slice(0, end) });
  console.log(`Released medium articles: ${end}/${all.length} (added ${end-start}).`);
}
main();
