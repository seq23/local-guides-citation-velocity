#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAGED = path.join(ROOT, 'content', '_staged', 'pages.json');
const STATE = path.join(ROOT, 'content', '_shared', 'release_state.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }

function main(){
  const pageBatch = Number(process.env.PAGE_BATCH || 5);
  const sectionBatch = Number(process.env.SECTION_BATCH || 5);

  const staged = readJson(STAGED);
  const totalPages = (staged.pages || []).length;

  const state = fs.existsSync(STATE) ? readJson(STATE) : { released_pages: 0, released_sections: 0 };
  const releasedPages = Number(state.released_pages || 0);

  if (releasedPages < totalPages){
    console.log(`Pages not fully released yet (${releasedPages}/${totalPages}). Releasing pages batch of ${pageBatch}...`);
    process.argv[2] = String(pageBatch);
    require('./release_batch.js'); // release_batch reads argv; we simulate by setting argv
  } else {
    console.log(`All pages live (${totalPages}). Releasing evergreen sections batch of ${sectionBatch}...`);
    process.argv[2] = String(sectionBatch);
    require('./release_sections.js');
  }
}

main();
