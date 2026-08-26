#!/usr/bin/env node
'use strict';
/**
 * Install the Microsoft Clarity tag into every published page.
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

if (!fs.existsSync(CONFIG)) {
  console.error(`clarity: missing ${path.relative(ROOT, CONFIG)}`);
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const projects = cfg.projects || {};
const outDir = path.resolve(ROOT, cfg.public_root || '.');
const skipDirs = new Set([
  ...(cfg.skip_dirs || []),
  '.git', 'node_modules', '.pages-output', 'dist', 'scripts', 'data', 'reports',
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
const loaderJs = `(function(w,d,m){var h=(w.location.hostname||"").toLowerCase().replace(/^www\\./,"");var id=m[h];if(!id)return;w.clarity=w.clarity||function(){(w.clarity.q=w.clarity.q||[]).push(arguments)};var s=d.createElement("script");s.async=1;s.src="https://www.clarity.ms/tag/"+id;var f=d.getElementsByTagName("script")[0];f.parentNode.insertBefore(s,f)})(window,document,${JSON.stringify(projects)})`;
const snippet = `<script ${MARKER} src="/${LOADER_REL}" defer></script>`;

let upgraded = 0;
let touched = 0;
let already = 0;
let skipped = 0;

function walk(dir, depth) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!skipDirs.has(entry.name)) walk(abs, depth + 1); continue; }
    if (!entry.name.endsWith('.html')) continue;
    const rel = path.relative(outDir, abs).replace(/\\/g, '/');
    if (skipFiles.has(rel) || skipFiles.has(entry.name)) { skipped += 1; continue; }
    const html = fs.readFileSync(abs, 'utf8');
    // Pages carrying the older inline loader are upgraded rather than skipped.
    // Leaving them would leave a tag the CSP refuses to execute, which is
    // indistinguishable from having no tag at all.
    const inlineLoader = new RegExp(`<script ${MARKER}>[\\s\\S]*?<\\/script>`, 'i');
    if (inlineLoader.test(html)) {
      fs.writeFileSync(abs, html.replace(inlineLoader, snippet));
      upgraded += 1;
      continue;
    }
    if (html.includes(MARKER)) { already += 1; continue; }
    if (!/<\/head>/i.test(html)) { skipped += 1; continue; }
    fs.writeFileSync(abs, html.replace(/<\/head>/i, `${snippet}</head>`));
    touched += 1;
  }
}
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

walk(outDir, 0);

console.log(`clarity: installed on ${touched} page(s); upgraded ${upgraded} from the inline loader; ${already} already correct; ${skipped} skipped`);
