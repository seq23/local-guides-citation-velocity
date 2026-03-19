#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAGED = path.join(ROOT, 'content', '_staged', 'pages.json');
const LIVE = path.join(ROOT, 'content', '_live', 'pages.json');
const STATE = path.join(ROOT, 'content', '_shared', 'release_state.json');
const REQUIRED_HUB_SLUGS = new Set([
  '/personal-injury/',
  '/dentistry/',
  '/trt/',
  '/neuro/',
  '/uscis-medical/'
]);

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeJson(p, o){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(o, null, 2)+'\n','utf8'); }

function main(){
  const batchSize = Number(process.argv[2] || 10);
  if (!Number.isFinite(batchSize) || batchSize <= 0) throw new Error('Provide batch size as a positive number');

  const staged = readJson(STAGED);
  const all = staged.pages || [];
  const bySlug = new Map(all.map((page) => [page.slug, page]));

  const missingRequired = Array.from(REQUIRED_HUB_SLUGS).filter((slug) => !bySlug.has(slug));
  if (missingRequired.length) {
    throw new Error(`Staged pages missing required hub slugs: ${missingRequired.join(', ')}`);
  }

  const state = fs.existsSync(STATE) ? readJson(STATE) : { released_pages: 0 };
  const start = Number(state.released_pages || 0);
  const end = Math.min(all.length, start + batchSize);

  const selected = [];
  const seen = new Set();
  for (const page of all.slice(0, end)) {
    if (seen.has(page.slug)) continue;
    selected.push(page);
    seen.add(page.slug);
  }
  for (const slug of REQUIRED_HUB_SLUGS) {
    if (seen.has(slug)) continue;
    selected.push(bySlug.get(slug));
    seen.add(slug);
  }

  const live = { pages: selected };
  writeJson(LIVE, live);

  state.released_pages = end;
  writeJson(STATE, state);

  const forcedHubs = selected.length - end;
  console.log(`Released pages: ${end}/${all.length} (added ${end-start}; forced hubs ${forcedHubs}).`);
  if (end === all.length) console.log('All staged pages are now live.');
}

main();
