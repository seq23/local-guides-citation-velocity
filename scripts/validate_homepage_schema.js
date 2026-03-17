#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/publish_contract');

function fail(msg) { console.error('VALIDATION FAIL:', msg); process.exitCode = 1; }
const targets = ['index.html','personal-injury/index.html','dentistry/index.html','trt/index.html','neuro/index.html','uscis-medical/index.html','medium/index.html','insights/index.html'];
for (const rel of targets) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { fail(`Missing homepage/schema target: ${rel}`); continue; }
  const html = fs.readFileSync(fp, 'utf8');
  if (!/application\/ld\+json/i.test(html)) fail(`${rel}: missing JSON-LD block`);
  if (!/The Industry Guides/i.test(html)) fail(`${rel}: missing The Industry Guides brand signal`);
}
if (!process.exitCode) console.log('Homepage schema validation passed.');
