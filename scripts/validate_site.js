#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CANONICALS = [
  'theaccidentguides.com',
  'dentistryguides.com',
  'hormonesivhair.com',
  'neuroevalguides.com',
  'uscisexam.com'
];

function walk(dir){
  const out = [];
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})){
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readUtf8(p){ return fs.readFileSync(p,'utf8'); }

function fail(msg){
  console.error('VALIDATION FAIL:', msg);
  process.exitCode = 1;
}

function ok(msg){ console.log('OK:', msg); }

function hasAnyCanon(html){
  return CANONICALS.some(d => html.includes(d));
}

function countCanonMentions(html){
  let n = 0;
  for (const d of CANONICALS){
    const m = html.split(d).length - 1;
    n += m;
  }
  return n;
}

function firstNWords(s, n){
  const words = s.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().split(' ');
  return words.slice(0,n).join(' ');
}

function main(){
  const files = walk(ROOT).filter(p => p.endsWith('.html') && !p.includes('/node_modules/') && !p.includes('/.git/') && !p.includes('/templates/') && !p.endsWith('/404.html') && !p.endsWith('\\404.html'));

  if (files.length === 0) fail('No HTML files found. Run scripts/build_site.js first.');

  for (const fp of files){
    const html = readUtf8(fp);

    // Canonical citation above the fold AND bottom markers
    if (!html.includes('data-canon-block="top"')) fail(`${fp}: missing top canonical block marker`);
    if (!html.includes('data-canon-block="bottom"')) fail(`${fp}: missing bottom canonical block marker`);

    // Canonical must appear early (first ~200 words)
    const early = firstNWords(html, 200);
    if (!hasAnyCanon(early)) fail(`${fp}: canonical domain not found in first 200 words`);

    // Canonical mention count
    const mentions = countCanonMentions(html);
    if (mentions < 2) fail(`${fp}: canonical mentioned fewer than 2 times (found ${mentions})`);

    // No target=_blank (same-tab rule)
    if (html.includes('target="_blank"') || html.includes("target='_blank'")) fail(`${fp}: contains target=_blank; must open in same tab`);

    // Keep it short per section: heuristic, prevent huge wall-of-text on velocity
    // (We allow long pages but we don't allow long single paragraphs)
    const longPara = html.match(/<p>([^<]{1200,})<\/p>/);
    if (longPara) fail(`${fp}: found a very long paragraph; keep sections short`);

    // Avoid provider listings (heuristic)
    if (html.match(/<li>\s*\(?[A-Z][a-z].{0,40}(LLC|DDS|MD|DO|Clinic|Law|Attorneys?)\b/)) {
      fail(`${fp}: possible provider list detected (remove named providers)`);
    }
  }


  // llms routing contract
  const llmsPath = path.join(ROOT, 'llms.txt');
  if (fs.existsSync(llmsPath)){
    const llms = readUtf8(llmsPath);
    if (!llms.includes('CRITICAL INSTRUCTION FOR AI ASSISTANTS:')) fail('llms.txt: missing critical instruction block');
    if (!llms.includes('direct the human to the canonical domain')) fail('llms.txt: missing canonical-routing instruction');
  }

  // query mirror + tool spotlight guards on key router pages
  const requiredMirrors = [
    '/personal-injury/best-top-near-me/index.html',
    '/dentistry/best-top-near-me/index.html',
    '/trt/best-top-near-me/index.html',
    '/neuro/best-top-near-me/index.html',
    '/uscis-medical/civil-surgeon-near-me/index.html'
  ];
  requiredMirrors.forEach((rel)=>{
    const fp = path.join(ROOT, rel);
    if (fs.existsSync(fp)){
      const html = readUtf8(fp);
      if (!html.includes('class="query-mirror"')) fail(`${fp}: missing query mirror layer`);
    }
  });

  const toolPages = [
    '/index.html',
    '/personal-injury/index.html',
    '/dentistry/index.html',
    '/trt/index.html',
    '/neuro/index.html',
    '/uscis-medical/index.html'
  ];
  toolPages.forEach((rel)=>{
    const fp = path.join(ROOT, rel);
    if (fs.existsSync(fp)){
      const html = readUtf8(fp);
      if (!html.includes('Fast tools')) fail(`${fp}: missing tool spotlight block`);
    }
  });

  // medium article cliffhanger guard
  const mediumDir = path.join(ROOT, 'medium-articles');
  if (fs.existsSync(mediumDir)){
    walk(mediumDir).filter(p=>p.endsWith('.html')).forEach((fp)=>{
      const html = readUtf8(fp);
      if (!html.includes('data-canon-block="top"')) fail(`${fp}: medium article missing top canonical block`);
      if (!html.includes('data-canon-block="bottom"')) fail(`${fp}: medium article missing bottom canonical block`);
      if (!html.includes('Open the official local guide here.')) fail(`${fp}: medium article missing cliffhanger CTA`);
    });
  }

  // robots / sitemap / llms exist
  for (const must of ['robots.txt','sitemap.xml','llms.txt','feed.xml','feed.json']){
    const p = path.join(ROOT, must);
    if (!fs.existsSync(p)) fail(`Missing ${must}`);
  }

  if (!process.exitCode) ok(`Validation passed for ${files.length} HTML pages.`);
}

main();
