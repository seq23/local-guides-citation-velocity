#!/usr/bin/env node
'use strict';
/**
 * Install Microsoft Clarity only on pages with a form or purchase link.
 *
 * The Clarity projects already existed - one per property - but no tag was ever
 * installed, so every project sat on "Almost there!" and none of them recorded a
 * single session. This closes that.
 *
 * The snippet resolves its project id from location.hostname rather than being
 * hardcoded, because some trees serve more than one domain from the same files
 * (spryexecutiveos.com and billionairehighperformancecoach.com are one tree with
 * two separate Clarity projects). A hardcoded id would send one domain's sessions
 * to the other domain's project.
 *
 * Idempotent: pages already carrying the marker are left alone, so this can run
 * on every build.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'data/clarity_projects.json');
const MARKER = 'data-clarity-loader';
const { installClarity } = require('./lib/clarity_page');
const { installProviderStart } = require('./lib/provider_start');
const { clarityRuntime } = require('./lib/clarity_runtime');

if (!fs.existsSync(CONFIG)) {
  console.error(`clarity: missing ${path.relative(ROOT, CONFIG)}`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const projects = cfg.projects || {};
const outDir = path.resolve(ROOT, cfg.public_root || '.');
const skipDirs = new Set([
  ...(cfg.skip_dirs || []),
  '.git', 'node_modules', '.pages-output', 'dist', '.build-cache', 'scripts', 'data', 'reports',
  'artifacts', 'docs', 'tests', 'fixtures', 'config', 'content', 'templates',
]);
const skipFiles = new Set(cfg.skip_files || []);

if (!Object.keys(projects).length) {
  console.error('clarity: no projects configured');
  process.exit(1);
}

// One loader for every page. It picks the project by host so a shared tree cannot
// report one domain's sessions under another domain's project.
// The loader used to be inline. This repo serves a strict CSP (script-src
// 'self'), so the browser refused to execute it and Clarity collected nothing -
// the tag was in the HTML on every page and the project stayed empty. Writing
// the loader to a same-origin file makes it satisfy 'self' without weakening the
// policy with 'unsafe-inline'.
const LOADER_REL = 'assets/clarity-loader.js';
const loaderJs = `(${clarityRuntime.toString()})(window,document,${JSON.stringify(projects)});`;
const snippet = `<script ${MARKER} src="/${LOADER_REL}" defer></script>`;

let upgraded = 0;
let touched = 0;
let already = 0;
let skipped = 0;
const pending = [];

function walk(dir, depth) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!skipDirs.has(entry.name)) walk(abs, depth + 1); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const rel = path.relative(outDir, abs).replace(/\\/g, '/');
    if (skipFiles.has(rel) || skipFiles.has(entry.name)) { skipped += 1; continue; }
    const html = fs.readFileSync(abs, 'utf8');
    const prepared = rel === 'index.html' ? installProviderStart(html, ROOT) : html;
    const after = installClarity(prepared, snippet);
    if (after === html) { already += 1; continue; }
    pending.push([abs, after]);
    if (after.includes(MARKER)) touched += 1;
    else upgraded += 1; // removed a tag from a page without a conversion step

  }
}
// Validate every transform before writing anything, including the loader.
walk(outDir, 0);

// The loader must exist at the same origin it is requested from, so write it
// into the output tree before pages are rewritten to reference it.
// Written to the source assets directory as well as the output tree. The source
// copy is what makes it a declared public file that the build copies and that
// the internal-href validator can resolve; writing only into dist leaves a page
// referencing a file the repo does not know about.
for (const base of new Set([ROOT, outDir])) {
  const loaderAbs = path.join(base, LOADER_REL);
  fs.mkdirSync(path.dirname(loaderAbs), { recursive: true });
  fs.writeFileSync(loaderAbs, loaderJs + '\n');
}

for (const [abs, after] of pending) fs.writeFileSync(abs, after);

console.log(`clarity: installed on ${touched} page(s); removed from ${upgraded} non-conversion page(s); ${already} already correct; ${skipped} skipped`);
