#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REQUIRED = [
  '.build/indexnow-priority.txt',
  '.build/indexnow-batch.txt',
  '.build/distribution-priority-urls.txt',
  '.build/distribution-readme.txt'
];

function fail(message) {
  console.error('VALIDATION FAIL:', message);
  process.exitCode = 1;
}

function readLines(rel) {
  const abs = path.join(ROOT, rel);
  return fs.readFileSync(abs, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

for (const rel of REQUIRED) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) fail(`Missing distribution artifact: ${rel}`);
}

if (!process.exitCode) {
  const priority = readLines('.build/indexnow-priority.txt');
  const batch = readLines('.build/indexnow-batch.txt');
  const dist = readLines('.build/distribution-priority-urls.txt');
  const sitePrefix = 'https://theindustryguides.com/';

  if (!priority.length) fail('indexnow-priority.txt is empty');
  if (priority.length > 50) fail(`indexnow-priority.txt too large (${priority.length}); must stay <= 50 URLs`);
  if (!batch.length) fail('indexnow-batch.txt is empty');
  if (!dist.length) fail('distribution-priority-urls.txt is empty');

  const seen = new Set();
  for (const url of priority) {
    if (!url.startsWith(sitePrefix)) fail(`Priority URL outside expected host: ${url}`);
    if (seen.has(url)) fail(`Duplicate priority URL: ${url}`);
    seen.add(url);
  }

  for (const url of dist) {
    if (!priority.includes(url)) fail(`distribution-priority-urls.txt contains URL not present in priority set: ${url}`);
  }

  console.log(`Distribution input validation passed (priority=${priority.length}, batch=${batch.length})`);
}
