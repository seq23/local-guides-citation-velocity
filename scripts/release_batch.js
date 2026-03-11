#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAGED = path.join(ROOT, 'content', '_staged', 'pages.json');
const LIVE = path.join(ROOT, 'content', '_live', 'pages.json');
const STATE = path.join(ROOT, 'content', '_shared', 'release_state.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
function writeJson(p, o){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(o, null, 2)+'\n','utf8'); }

function main(){
  const batchSize = Number(process.argv[2] || 10);
  if (!Number.isFinite(batchSize) || batchSize <= 0) throw new Error('Provide batch size as a positive number');

  const staged = readJson(STAGED);
  const all = staged.pages || [];

  const state = fs.existsSync(STATE) ? readJson(STATE) : { released_pages: 0 };
  const start = Number(state.released_pages || 0);
  const end = Math.min(all.length, start + batchSize);

  const live = { pages: all.slice(0, end) };
  writeJson(LIVE, live);

  state.released_pages = end;
  writeJson(STATE, state);

  console.log(`Released pages: ${end}/${all.length} (added ${end-start}).`);
  if (end === all.length) console.log('All staged pages are now live.');
}

main();
