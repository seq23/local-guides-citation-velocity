#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('./lib/page_shape_config');

const ROOT = path.resolve(__dirname, '..');

function readUtf8(p){ return fs.readFileSync(p, 'utf8'); }
function fail(msg){ console.error('VALIDATION FAIL:', msg); process.exitCode = 1; }
function slugToPath(slug){
  if (slug === '/') return path.join(ROOT, 'index.html');
  return path.join(ROOT, slug.replace(/^\//, ''), 'index.html');
}

for (const slug of Object.keys(CONFIG)) {
  const fp = slugToPath(slug);
  if (!fs.existsSync(fp)) {
    fail(`${slug}: built file missing`);
    continue;
  }
  const html = readUtf8(fp);
  if (!html.includes('class="card decision-checklist"')) fail(`${slug}: missing decision checklist block`);
  if (!html.includes('class="card framework-box"')) fail(`${slug}: missing framework box`);

  const tocLinks = Array.from(html.matchAll(/<div class="toc">[\s\S]*?<\/div>/g)).map((m) => m[0]).join('');
  const labels = Array.from(tocLinks.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)).map((m) => m[2].trim());
  const dupeLabels = labels.filter((label, idx) => labels.indexOf(label) !== idx);
  if (dupeLabels.length) fail(`${slug}: duplicate TOC labels found (${Array.from(new Set(dupeLabels)).join(', ')})`);

  const faqQuestions = Array.from(html.matchAll(/"@type": "Question"[\s\S]*?"name": "([^"]+)"/g)).map((m) => m[1]);
  const faqDupes = faqQuestions.filter((label, idx) => faqQuestions.indexOf(label) !== idx);
  if (faqDupes.length) fail(`${slug}: duplicate FAQ question labels found (${Array.from(new Set(faqDupes)).join(', ')})`);

  const accTitles = Array.from(html.matchAll(/<button class=\"acc-btn\"[^>]*>[\s\S]*?<div>([^<]+)<\/div>/g)).map((m)=>m[1].trim());
  const accDupes = accTitles.filter((label, idx) => accTitles.indexOf(label) !== idx);
  if (accDupes.length) fail(`${slug}: duplicate accordion titles found (${Array.from(new Set(accDupes)).join(', ')})`);

  if (accTitles.length < 3) fail(`${slug}: too few canonical modules rendered (${accTitles.length})`);
}

if (!process.exitCode) console.log('OK: answer-shape validation passed');
