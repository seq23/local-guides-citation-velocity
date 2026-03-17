#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function normalizeRel(p) {
  const rel = path.isAbsolute(p) ? path.relative(ROOT, p) : p;
  return rel.replace(/\\/g, '/').trim();
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  return text ? text.split(/\s+/).filter(Boolean).length : 0;
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function validateFile(rel) {
  const abs = path.join(ROOT, rel);
  const html = fs.readFileSync(abs, 'utf8');

  if (!/<title>[^<]{3,}<\/title>/i.test(html)) return `${rel}: missing or empty <title>`;
  if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html)) return `${rel}: missing <h1>`;
  if (!/(<meta[^>]*name=["']description["'][^>]*content=(?:"[^"]{20,}"|'[^']{20,}')|<meta[^>]*content=(?:"[^"]{20,}"|'[^']{20,}')[^>]*name=["']description["'])/i.test(html)) return `${rel}: missing meta description`;
  if (!/data-canon-block=("|')top\1/i.test(html) && !/<!--\s*CANON_TOP\s*-->/i.test(html)) return `${rel}: missing top canonical block marker`;
  if (!/data-canon-block=("|')bottom\1/i.test(html) && !/<!--\s*CANON_BOTTOM\s*-->/i.test(html)) return `${rel}: missing bottom canonical block marker`;

  const wc = wordCount(stripHtml(html));
  if (wc < 120) return `${rel}: too short (${wc} words)`;
  return null;
}

function main() {
  const args = process.argv.slice(2).map(normalizeRel).filter(Boolean);
  const scanAll = args.includes('--all');
  let targets = [];

  if (scanAll) {
    const dir = path.join(ROOT, 'insights');
    if (!fs.existsSync(dir)) {
      console.log('No insights directory found. Skipping.');
      process.exit(0);
    }
    targets = walk(dir)
      .filter((p) => p.endsWith('/index.html') || p.endsWith(path.sep + 'index.html'))
      .map(normalizeRel);
  } else {
    targets = args.filter((p) => p.startsWith('insights/') && p.endsWith('/index.html'));
  }

  if (!targets.length) {
    console.log(scanAll ? 'No insights found to validate.' : 'No changed insights/**/index.html files to validate. Skipping.');
    process.exit(0);
  }

  const errors = [];
  for (const rel of targets) {
    const err = validateFile(rel);
    if (err) errors.push(err);
  }

  if (errors.length) {
    console.error('\nX Insights validation failed:\n');
    errors.forEach((e) => console.error('- ' + e));
    console.error('\nFix the issues and push again.\n');
    process.exit(1);
  }

  console.log(scanAll ? `Insights validation passed (${targets.length} files checked).` : `Insights validation passed (${targets.length} changed files checked).`);
}

main();
