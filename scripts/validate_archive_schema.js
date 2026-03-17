#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, CANONICAL_DOMAINS } = require('./lib/publish_contract');

function fail(msg) { console.error('VALIDATION FAIL:', msg); process.exitCode = 1; }
function firstWords(html, n) { return html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ').replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, n).join(' '); }
['medium/index.html', 'insights/index.html'].forEach((rel) => {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { fail(`Missing archive page: ${rel}`); return; }
  const html = fs.readFileSync(fp, 'utf8');
  if (!html.includes('application/ld+json')) fail(`${rel}: missing JSON-LD`);
  if (!html.includes('The Industry Guides')) fail(`${rel}: missing publisher brand`);
  const early = firstWords(html, 200);
  for (const domain of CANONICAL_DOMAINS) {
    if (!early.includes(domain)) fail(`${rel}: canonical domain missing from first 200 words: ${domain}`);
  }
});
if (!process.exitCode) console.log('Archive schema validation passed.');
