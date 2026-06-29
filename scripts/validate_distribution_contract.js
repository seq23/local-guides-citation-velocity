#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'distribution.config.json');
const EXAMPLE = path.join(ROOT, 'distribution.config.example.json');

function fail(message) {
  console.error('VALIDATION FAIL:', message);
  process.exitCode = 1;
}
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const configPath = fs.existsSync(CONFIG) ? CONFIG : EXAMPLE;
if (!fs.existsSync(configPath)) fail('Missing distribution config file');

if (!process.exitCode) {
  const config = readJson(configPath);
  const idx = config.indexnow || {};
  const gsc = config.gsc || {};
  const inspection = config.inspection || {};
  if (!Array.isArray(idx.hosts) || !idx.hosts.length) fail('indexnow.hosts must contain at least one host');
  if (!idx.key || !String(idx.key).trim()) fail('indexnow.key must be committed and non-empty');
  if (!idx.key_file || !String(idx.key_file).trim()) fail('indexnow.key_file must be committed and non-empty');
  if (!idx.priority_file || !idx.batch_file) fail('indexnow priority/batch files must be configured');
  if (!Number.isInteger(idx.chunk_size) || idx.chunk_size <= 0) fail('indexnow.chunk_size must be a positive integer');
  const keyPath = path.join(ROOT, idx.key_file);
  if (!fs.existsSync(keyPath)) fail(`Committed key file missing: ${idx.key_file}`);
  const keyValue = fs.readFileSync(keyPath, 'utf8').trim();
  if (keyValue !== String(idx.key).trim()) fail(`Committed key file does not match configured key: ${idx.key_file}`);
  const rootIndexNow = path.join(ROOT, 'indexnow.txt');
  if (!fs.existsSync(rootIndexNow)) fail('indexnow.txt missing at repo root');
  if (fs.readFileSync(rootIndexNow, 'utf8').trim() !== String(idx.key).trim()) fail('indexnow.txt does not match configured key');
  if (!Array.isArray(gsc.sites) || !gsc.sites.length) fail('gsc.sites must contain at least one configured site');
  for (const site of gsc.sites) {
    if (!site.host || !site.site_url) fail('Each gsc site entry must include host and site_url');
    if (!Array.isArray(site.sitemaps) || !site.sitemaps.length) fail(`GSC site ${site.host} missing sitemap list`);
  }
  if (!inspection.priority_file || !inspection.output_dir) fail('inspection priority_file/output_dir must be configured');
  console.log(`Distribution contract validation passed (hosts=${idx.hosts.length}, chunk_size=${idx.chunk_size})`);
}

if (!process.exitCode) {
  const outDir = path.join(ROOT, 'artifacts', 'validation');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'distribution-contract.json'), JSON.stringify({
    status: 'PASS',
    validator: 'distribution-contract',
    config_file: path.relative(ROOT, configPath).replace(/\\/g, '/'),
    generated_at: new Date().toISOString()
  }, null, 2) + '\n');
}
