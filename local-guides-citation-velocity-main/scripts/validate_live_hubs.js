#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIVE = path.join(ROOT, 'content', '_live', 'pages.json');
const REQUIRED_HUB_SLUGS = [
  '/personal-injury/',
  '/dentistry/',
  '/trt/',
  '/neuro/',
  '/uscis-medical/'
];

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  if (!fs.existsSync(LIVE)) {
    throw new Error('Missing content/_live/pages.json');
  }

  const live = readJson(LIVE);
  const pages = Array.isArray(live.pages) ? live.pages : [];
  const slugs = new Set(pages.map((page) => page && page.slug).filter(Boolean));
  const missing = REQUIRED_HUB_SLUGS.filter((slug) => !slugs.has(slug));

  if (missing.length) {
    console.error(`VALIDATION FAIL: LIVE/pages.json missing required hub slugs: ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log(`Live hub validation passed (${REQUIRED_HUB_SLUGS.length} required hubs present).`);
}

main();
