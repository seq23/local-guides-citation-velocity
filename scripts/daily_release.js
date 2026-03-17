#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STAGED = path.join(ROOT, 'content', '_staged', 'pages.json');

const STATE = path.join(ROOT, 'content', '_shared', 'release_state.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }
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
function countIndexPages(dirName){
  return walk(path.join(ROOT, dirName)).filter(fp => fp.endsWith(path.sep + 'index.html') || fp.endsWith('/index.html')).length;
}

function main(){
  const pageBatch = Number(process.env.PAGE_BATCH || 5);
  const sectionBatch = Number(process.env.SECTION_BATCH || 5);
  const articleBatch = Number(process.env.MEDIUM_BATCH || 1);
  const insightBatch = Number(process.env.INSIGHT_BATCH || 1);

  const staged = readJson(STAGED);
  const totalPages = (staged.pages || []).length;
  const totalMedium = countIndexPages('medium-articles');
  const totalInsights = countIndexPages('insights');

  const state = fs.existsSync(STATE) ? readJson(STATE) : { released_pages: 0, released_sections: 0, released_medium_articles: totalMedium, released_insights: totalInsights };
  const releasedPages = Number(state.released_pages || 0);
  const releasedMedium = Number.isFinite(Number(state.released_medium_articles)) ? Number(state.released_medium_articles) : totalMedium;
  const releasedInsights = Number.isFinite(Number(state.released_insights)) ? Number(state.released_insights) : totalInsights;

  if (releasedPages < totalPages){
    console.log(`Pages not fully released yet (${releasedPages}/${totalPages}). Releasing pages batch of ${pageBatch}...`);
    process.argv[2] = String(pageBatch);
    require('./release_batch.js');
  } else {
    console.log(`All pages live (${totalPages}). Releasing evergreen sections batch of ${sectionBatch}...`);
    process.argv[2] = String(sectionBatch);
    require('./release_sections.js');
  }

  if (releasedMedium < totalMedium){
    console.log(`Releasing medium article batch of ${articleBatch}...`);
    process.argv[2] = String(articleBatch);
    require('./release_medium_articles.js');
  } else {
    console.log(`All medium articles already released (${releasedMedium}/${totalMedium}).`);
  }

  if (releasedInsights < totalInsights){
    console.log(`Releasing insights batch of ${insightBatch}...`);
    process.argv[2] = String(insightBatch);
    require('./release_insights.js');
  } else {
    console.log(`All insights already released (${releasedInsights}/${totalInsights}).`);
  }
}

main();
