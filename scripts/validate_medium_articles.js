#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const ALLOWED_VERTICALS = new Set([
  'dentistry',
  'pi',
  'neuro',
  'trt',
  'uscis',
]);

function normalizeRel(p) {
  const rel = path.isAbsolute(p) ? path.relative(ROOT, p) : p;
  return rel.replace(/\\/g, '/').trim();
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

function isMediumIndexHtml(rel) {
  // medium-articles/<vertical>/<slug>/index.html
  const parts = rel.split('/');
  return parts.length === 4 && parts[0] === 'medium-articles' && parts[3] === 'index.html';
}

function validateFile(relPath) {
  const rel = normalizeRel(relPath);

  if (!isMediumIndexHtml(rel)) {
    return fail(rel, 'Path must be medium-articles/<vertical>/<slug>/index.html');
  }

  const parts = rel.split('/');
  const vertical = parts[1];
  const slug = parts[2];

  if (!ALLOWED_VERTICALS.has(vertical)) {
    return fail(rel, `Vertical "${vertical}" not allowed. Allowed: ${Array.from(ALLOWED_VERTICALS).join(', ')}`);
  }

  if (!/^[a-z0-9-]+$/.test(slug)) {
    return fail(rel, `Slug "${slug}" must be lowercase kebab-case (a-z, 0-9, hyphen).`);
  }

  const abs = path.join(ROOT, rel);

  // Deletions are allowed. If file missing (removed/renamed away), skip.
  if (!fs.existsSync(abs)) {
    return null;
  }

  const html = fs.readFileSync(abs, 'utf8');

  // Required tags/blocks
  if (!/<title>[^<]{3,}<\/title>/i.test(html)) {
    return fail(rel, 'Missing or empty <title> tag.');
  }

  // Require a non-trivial description (min ~20 chars), regardless of attribute order
  if (!/(<meta[^>]*name=["']description["'][^>]*content=(?:"[^"]{20,}"|'[^']{20,}')|<meta[^>]*content=(?:"[^"]{20,}"|'[^']{20,}')\s+[^>]*name=["']description["'])/i.test(html)) {
    return fail(rel, 'Missing or too-short <meta name="description" content="..."> (min ~20 chars).');
  }

  // Require https canonical, regardless of attribute order
  if (!/(<link[^>]*rel=["']canonical["'][^>]*href=["']https:\/\/[^"']+["']|<link[^>]*href=["']https:\/\/[^"']+["'][^>]*rel=["']canonical["'])/i.test(html)) {
    return fail(rel, 'Missing <link rel="canonical" href="https://...">.');
  }

  if (!/<h1\b[^>]*>[\s\S]*?<\/h1>/i.test(html)) {
    return fail(rel, 'Missing <h1>...</h1>.');
  }

  if (!/Originally published (at|on)/i.test(html)) {
    return fail(rel, 'Missing original publication attribution line.');
  }

  if (!html.includes('data-canon-block="top"')) {
    return fail(rel, 'Missing top canonical block marker.');
  }

  if (!html.includes('data-canon-block="bottom"')) {
    return fail(rel, 'Missing bottom canonical block marker.');
  }

  const early = stripHtml(html).split(/\s+/).slice(0, 200).join(' ');
  if (!/theaccidentguides\.com|dentistryguides\.com|hormonesivhair\.com|neuroevalguides\.com|uscisexam\.com/i.test(early)) {
    return fail(rel, 'Canonical domain not found in first 200 words.');
  }

  if (!html.includes('Open the official local guide here.')) {
    return fail(rel, 'Missing cliffhanger CTA.');
  }

  if (!/<h2\b|<h3\b/i.test(html)) {
    return fail(rel, 'Must include at least one <h2> or <h3>.');
  }

  const text = stripHtml(html);
  const wc = wordCount(text);

  // Cushion around your 600ÃÂ¢ÃÂÃÂ1000 target; avoids false fails.
  if (wc < 600 || wc > 1200) {
    return fail(rel, `Word count must be 600-1200. Detected: ${wc}.`);
  }

  return null;
}

function main() {
  const args = process.argv.slice(2).map(normalizeRel).filter(Boolean);
  const scanAll = args.includes('--all');

  let targets = [];

  if (scanAll) {
    function walk(dir) {
      for (const name of fs.readdirSync(dir)) {
        const abs = path.join(dir, name);
        const stat = fs.statSync(abs);
        if (stat.isDirectory()) walk(abs);
        else if (stat.isFile()) {
          const rel = normalizeRel(abs);
          if (rel.startsWith('medium-articles/') && rel.endsWith('/index.html')) targets.push(rel);
        }
      }
    }
    walk(path.join(ROOT, 'medium-articles'));
  } else {
    // Validate only changed medium articles when file paths are provided.
    targets = args
      .filter((p) => p.startsWith('medium-articles/'))
      .filter((p) => p.endsWith('/index.html'));
  }

  targets = Array.from(new Set(targets)).sort();

  if (targets.length === 0) {
    console.log(scanAll ? 'No medium articles found to validate.' : 'No changed medium-articles/**/index.html files to validate. Skipping.');
    process.exit(0);
  }

  const errors = [];
  for (const rel of targets) {
    const err = validateFile(rel);
    if (err) errors.push(err);
  }

  if (errors.length) {
    console.error('\nÃÂ¢ÃÂÃÂ Medium articles validation failed:\n');
    for (const e of errors) {
      console.error(`- ${e.file}: ${e.msg}`);
    }
    console.error('\nFix the issues and push again.\n');
    process.exit(1);
  }

  console.log(scanAll ? `Medium articles validation passed (${targets.length} files checked).` : `Medium articles validation passed (${targets.length} changed files checked).`);
  process.exit(0);
}

main();
