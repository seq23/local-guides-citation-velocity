#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { ROOT, MEDIUM_MANIFEST_PATH, INSIGHTS_MANIFEST_PATH, loadJson } = require('./lib/publish_contract');

function fail(msg) { console.error('VALIDATION FAIL:', msg); process.exitCode = 1; }
let trackedDist = '';
try {
  trackedDist = execFileSync('git', ['ls-files', '--', 'dist'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore','pipe','ignore']
  }).trim();
} catch (_) {
  trackedDist = '';
}
if (trackedDist) fail(`tracked dist/ files must not exist in publish repo: ${trackedDist.split('\n').join(', ')}`);
const mediumManifest = loadJson(MEDIUM_MANIFEST_PATH);
const insightManifest = loadJson(INSIGHTS_MANIFEST_PATH);
for (const item of mediumManifest.items || []) {
  const fp = path.join(ROOT, item.publish_path.replace(/^\//, ''), 'index.html');
  if (!fs.existsSync(fp)) fail(`medium inventory missing published file: ${item.publish_path}`);
}
const mediumRootFiles = fs.existsSync(path.join(ROOT, 'medium')) ? fs.readdirSync(path.join(ROOT, 'medium')).filter((name) => name.endsWith('.html') && name !== 'index.html') : [];
if (mediumRootFiles.length) fail(`medium/ must be archive-only; found generated article files: ${mediumRootFiles.join(', ')}`);
const insightExpected = new Set((insightManifest.items || []).map((item) => item.publish_path.replace(/^\//, '')));
const insightDir = path.join(ROOT, 'insights');
for (const name of fs.existsSync(insightDir) ? fs.readdirSync(insightDir) : []) {
  if (!name.endsWith('.html') || name === 'index.html') continue;
  const rel = `insights/${name}`;
  if (!insightExpected.has(rel)) fail(`published insight HTML missing from canonical insight inventory: ${rel}`);
}
for (const rel of insightExpected) {
  if (!fs.existsSync(path.join(ROOT, rel))) fail(`insight inventory missing published HTML: ${rel}`);
}
if (!process.exitCode) console.log('Publish inventory validation passed.');
