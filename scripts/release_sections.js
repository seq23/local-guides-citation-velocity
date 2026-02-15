#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = path.join(ROOT, 'content', '_live', 'pages.json');
const QUEUE = path.join(ROOT, 'content', '_staged', 'evergreen_section_queue.json');
const STATE = path.join(ROOT, 'content', '_shared', 'release_state.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeJson(p, o){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(o, null, 2)+'\n','utf8'); }

function ensureArray(v){ return Array.isArray(v) ? v : []; }

function main(){
  const batchSize = Number(process.argv[2] || 5);
  if (!Number.isFinite(batchSize) || batchSize <= 0) throw new Error('Provide batch size as a positive number');

  if (!fs.existsSync(QUEUE)) {
    console.log('No evergreen section queue found. Nothing to release.');
    return;
  }
  const q = readJson(QUEUE).queue || [];
  if (!fs.existsSync(LIVE)) throw new Error('Missing content/_live/pages.json');

  const state = fs.existsSync(STATE) ? readJson(STATE) : { released_pages: 0, released_sections: 0 };
  const start = Number(state.released_sections || 0);
  const end = Math.min(q.length, start + batchSize);

  if (start >= q.length) {
    console.log(`All evergreen sections already released (${q.length}).`);
    return;
  }

  const live = readJson(LIVE);
  const pages = ensureArray(live.pages);

  let added = 0;
  for (let i = start; i < end; i++){
    const item = q[i];
    const targetSlug = item.target_slug;
    const page = pages.find(p => p.slug === targetSlug);
    if (!page){
      console.log(`VALIDATION WARNING: target page not found for section release: ${targetSlug}`);
      continue;
    }
    page.sections = ensureArray(page.sections);
    const exists = page.sections.some(s => s.anchor === item.anchor);
    if (exists){
      console.log(`VALIDATION WARNING: duplicate anchor skipped: ${targetSlug}#${item.anchor}`);
      continue;
    }
    page.sections.push({
      anchor: item.anchor,
      title: item.title,
      answer: item.answer,
      checklist: ensureArray(item.checklist),
      red_flags: ensureArray(item.red_flags)
    });
    added++;
  }

  writeJson(LIVE, { pages });
  state.released_sections = end;
  writeJson(STATE, state);

  console.log(`Released evergreen sections: ${end}/${q.length} (added ${added}).`);
}

main();
