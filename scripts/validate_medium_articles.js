#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = path.join(ROOT, 'medium-articles');

const ALLOWED_VERTICALS = new Set([
  'dentistry',
  'personal-injury',
  'neuro',
  'trt',
  'uscis-medical',
]);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function stripHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function wordCount(text) {
  if (!text) return 0;
  return text.split(/\s+/).filter(Boolean).length;
}

function fail(file, msg) {
  return { file, msg };
}

function validateFile(fp) {
  const rel = path.relative(ROOT, fp).replace(/\\/g, '/');

  // Enforce: medium-articles/<vertical>/<slug>/index.html
  const parts = rel.split('/');
  if (parts.length !== 4 || parts[0] !== 'medium-articles' || parts[3] !== 'index.html') {
    return fail(rel, 'Path must be medium-articles/<vertical>/<slug>/index.html');
  }

  const vertical = parts[1];
  const slug = parts[2];

  if (!ALLOWED_VERTICALS.has(vertical)) {
    return fail(rel, `Vertical "${vertical}" not allowed. Allowed: ${Array.from(ALLOWED_VERTICALS).join(', ')}`);
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return fail(rel, `Slug "${slug}" must be lowercase kebab-case (a-z, 0-9, hyphen).`);
  }

  const html = fs.readFileSync(fp, 'utf8');

  if (!/<title>[^<]{3,}<\/title>/i.test(html)) {
    return fail(rel, 'Missing or empty <title> tag.');
  }

  if (!/<meta\s+name=["']description["']\s+content=["'][^"']{20,}["']\s*\/?>/i.test(html)) {
    return fail(rel, 'Missing or too-short <meta name="description" content="..."> (min ~20 chars).');
  }

  if (!/<link\s+rel=["']canonical["']\s+href=["']https:\/\/[^"']+["']\s*\/?>/i.test(html)) {
    return fail(rel, 'Missing <link rel="canonical" href="https://...">.');
  }

  if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html)) {
    return fail(rel, 'Missing <h1>...</h1>.');
  }

  if (!/Originally published at/i.test(html)) {
    return fail(rel, 'Missing "Originally published at {canonical_url}" line.');
  }

  if (!/<h2\b|<h3\b/i.test(html)) {
    return fail(rel, 'Must include at least one <h2> or <h3>.');
  }

  const text = stripHtml(html);
  const wc = wordCount(text);

  // Cushion around your 600–1000 target so you don’t fail for small differences.
  if (wc < 600 || wc > 1200) {
    return fail(rel, `Word count must be 600–1200. Detected: ${wc}.`);
  }

  return null;
}

function main() {
  if (!fs.existsSync(BASE)) {
    console.log('No medium-articles/ directory found. Nothing to validate.');
    process.exit(0);
  }

  const files = walk(BASE).filter((p) => p.endsWith('/index.html') || p.endsWith(path.sep + 'index.html'));

  if (files.length === 0) {
    console.log('No medium-articles/**/index.html files found. Nothing to validate.');
    process.exit(0);
  }

  const errors = [];
  for (const fp of files) {
    const err = validateFile(fp);
    if (err) errors.push(err);
  }

  if (errors.length) {
    console.error('\n❌ Medium articles validation failed:\n');
    for (const e of errors) {
      console.error(`- ${e.file}: ${e.msg}`);
    }
    console.error('\nFix the issues and push again.\n');
    process.exit(1);
  }

  console.log(`✅ Medium articles validation passed (${files.length} files checked).`);
  process.exit(0);
}

main();
