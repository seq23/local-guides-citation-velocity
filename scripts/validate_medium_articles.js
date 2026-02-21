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

  // Require a non-trivial description (min ~20 chars)
  if (!/<meta\s+name=["']description["']\s+content=(?:"[^"]{20,}"|'[^']{20,}')\s*\/?>/i.test(html)) {
    return fail(rel, 'Missing or too-short <meta name="description" content="..."> (min ~20 chars).');
  }

  // Require https canonical
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

  // Cushion around your 600Ã¢ÂÂ1000 target; avoids false fails.
  if (wc < 600 || wc > 1200) {
    return fail(rel, `Word count must be 600Ã¢ÂÂ1200. Detected: ${wc}.`);
  }

  return null;
}

function main() {
  // We validate ONLY files passed as CLI args (changed files from workflow).
  // If none are passed, we skip (because Ã¢ÂÂvalidate only what changedÃ¢ÂÂ).
  const args = process.argv.slice(2).map(normalizeRel).filter(Boolean);

  // Only consider medium-articles/**/index.html
  const targets = args
    .filter((p) => p.startsWith('medium-articles/'))
    .filter((p) => p.endsWith('/index.html'));

  if (targets.length === 0) {
    console.log('No changed medium-articles/**/index.html files to validate. Skipping.');
    process.exit(0);
  }

  const errors = [];
  for (const rel of targets) {
    const err = validateFile(rel);
    if (err) errors.push(err);
  }

  if (errors.length) {
    console.error('\nÃ¢ÂÂ Medium articles validation failed:\n');
    for (const e of errors) {
      console.error(`- ${e.file}: ${e.msg}`);
    }
    console.error('\nFix the issues and push again.\n');
    process.exit(1);
  }

  console.log(`Ã¢ÂÂ Medium articles validation passed (${targets.length} changed files checked).`);
  process.exit(0);
}

main();
