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
  if (!/(theaccidentguides\.com|dentistryguides\.com|hormonesivhair\.com|neuroevalguides\.com|uscisexam\.com)/i.test(html)) return `${rel}: missing canonical domain mention`;

  const wc = wordCount(stripHtml(html));
  if (wc < 120) return `${rel}: too short (${wc} words)`;
  return null;
}

// WHAT THIS USED TO DO, AND WHY IT WAS WRONG
//
// This validator is registered HARD_FAIL in six profiles (audit, core, local,
// postrelease, release, strict) with the command `node scripts/validate_insights.js`
// -- no `--all`, no file list. The central runner spawns that command string
// verbatim and never appends changed files, so every run took the "changed files"
// branch, found nothing, printed
//   "No changed insights HTML files to validate. Skipping."
// and exited 0. Meanwhile `find insights -name '*.html'` counts 1,243 pages.
// A HARD_FAIL gate in six profiles had never examined a single file.
//
// Two things changed:
//   1. No file list supplied now means validate the FULL set, not skip it. A
//      caller that genuinely wants changed-file scoping must pass the paths.
//   2. Examining zero files is a hard failure, never a pass. A gate that runs
//      and inspects nothing must not report green (Rule 0: no stage may exit 0
//      having done nothing). A missing insights/ directory is a named stop, not
//      a silent skip.
// No assertion was loosened; validateFile() is unchanged.
function main() {
  const args = process.argv.slice(2).map(normalizeRel).filter(Boolean);
  const fileArgs = args.filter((p) => !p.startsWith('--'));
  // Full scan is the default. Changed-file scoping is opt-in by passing paths.
  const scanAll = args.includes('--all') || fileArgs.length === 0;
  let targets = [];

  if (scanAll) {
    const dir = path.join(ROOT, 'insights');
    if (!fs.existsSync(dir)) {
      console.error('X Insights validation failed: no insights/ directory to validate.');
      console.error('  This gate is HARD_FAIL and must never pass having examined zero files.');
      process.exit(1);
    }
    targets = walk(dir)
      .filter((p) => p.endsWith('.html'))
      .filter((p) => !p.endsWith('/.html') && !p.endsWith('\\.html'))
      .map(normalizeRel);
  } else {
    targets = args.filter((p) => p.startsWith('insights/') && p.endsWith('.html'));
  }

  if (!targets.length) {
    console.error('\nX Insights validation failed: zero insight HTML files examined.\n');
    console.error(scanAll
      ? '- insights/ exists but contains no .html files. A HARD_FAIL gate that inspects nothing is not a pass.'
      : `- the ${fileArgs.length} path(s) supplied contain no insights/**/*.html file, so nothing was checked.`);
    console.error('\nRun with no arguments to validate the full insight corpus.\n');
    process.exit(1);
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
