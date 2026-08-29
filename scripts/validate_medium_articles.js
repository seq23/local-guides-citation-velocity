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

function fail(file, msg, severity = 'error') {
  return { file, msg, severity };
}

function hasCanonTop(html) {
  return /data-canon-block=(["'])top\1/i.test(html) || /<!--\s*CANON_TOP\s*-->/i.test(html);
}

function hasCanonBottom(html) {
  return /data-canon-block=(["'])bottom\1/i.test(html) || /<!--\s*CANON_BOTTOM\s*-->/i.test(html);
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

  if (!hasCanonTop(html)) {
    return fail(rel, 'Missing top canonical block marker.');
  }

  if (!hasCanonBottom(html)) {
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

  // Word count is editorial telemetry only.
  // Medium article length drift must not fail CI and must not emit validation warnings.
  // Structural and metadata defects above remain hard failures.
  void wc;

  return null;
}

// WHAT THIS USED TO DO, AND WHY IT WAS WRONG
//
// Registered as `node scripts/validate_medium_articles.js` -- no `--all`, no file
// list. The central runner spawns that string verbatim and never appends changed
// files, so the "changed files" branch always found nothing, printed
//   "No changed medium-articles/**/index.html files to validate. Skipping."
// and exited 0 while 14 syndicated articles sat on disk unexamined. Same shape as
// the insights gate; same fix.
//
//   1. No file list supplied now means validate the FULL set. Changed-file
//      scoping is opt-in by passing paths.
//   2. Examining zero articles is a failure, not a pass. A missing
//      medium-articles/ tree is a named stop, not a silent skip (Rule 0).
// No assertion was loosened; validateFile() is unchanged.
function main() {
  const args = process.argv.slice(2).map(normalizeRel).filter(Boolean);
  const fileArgs = args.filter((p) => !p.startsWith('--'));
  const scanAll = args.includes('--all') || fileArgs.length === 0;

  let targets = [];

  if (scanAll) {
    const root = path.join(ROOT, 'medium-articles');
    if (!fs.existsSync(root)) {
      console.error('X Medium articles validation failed: no medium-articles/ directory to validate.');
      console.error('  This gate must never report a pass having examined zero articles.');
      process.exit(1);
    }
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
    console.error('\nX Medium articles validation failed: zero articles examined.\n');
    console.error(scanAll
      ? '- medium-articles/ exists but contains no **/index.html file. A gate that inspects nothing is not a pass.'
      : `- the ${fileArgs.length} path(s) supplied contain no medium-articles/**/index.html file, so nothing was checked.`);
    console.error('\nRun with no arguments to validate the full syndicated corpus.\n');
    process.exit(1);
  }

  const findings = [];
  for (const rel of targets) {
    const finding = validateFile(rel);
    if (finding) findings.push(finding);
  }

  const errors = findings.filter((f) => f.severity !== 'warning');
  const warnings = findings.filter((f) => f.severity === 'warning');

  if (warnings.length) {
    console.warn('\n! Medium articles validation warnings:\n');
    for (const w of warnings) {
      console.warn(`- ${w.file}: ${w.msg}`);
    }
    console.warn('');
  }

  if (errors.length) {
    console.error('\nX Medium articles validation failed:\n');
    for (const e of errors) {
      console.error(`- ${e.file}: ${e.msg}`);
    }
    console.error('\nFix the issues and push again.\n');
    process.exit(1);
  }

  console.log(scanAll ? `Medium articles validation passed (${targets.length} files checked, ${warnings.length} warning(s)).` : `Medium articles validation passed (${targets.length} changed files checked, ${warnings.length} warning(s)).`);
  process.exit(0);
}

main();
