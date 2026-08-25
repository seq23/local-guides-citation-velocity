#!/usr/bin/env node
'use strict';
// Route AEO/GEO traffic to a provider request.
//
// Content pages surfaced in AI answers but had no path to a conversion surface.
// Two distinct populations:
//   - insights/*.html      answer pages with no canonical-site link at all
//   - vertical pillar pages linking the canonical site's HOMEPAGE, not its
//                          request surface - the reader must re-navigate
//
// The per-vertical destination map already exists in velocity_content_release.js
// and is read from there rather than duplicated: a drifted second copy would
// send a dentistry reader to a TRT clinic.
//
// Vertical detection prefers the canonical-site link the page already carries
// (dentistryguides.com -> dentistry) over the path prefix. The page states its
// own vertical; inferring it from a filename is guessing at something already
// known. Path prefix is the fallback for pages with no canonical link.
//
// Idempotent. --dry-run to inspect.

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry-run');

const src = fs.readFileSync(path.join(ROOT, 'scripts/velocity_content_release.js'), 'utf8');
const m = src.match(/const targets\s*=\s*(\{[\s\S]*?\});/);
if (!m) { console.error('[conversion-routing] cannot read targets map'); process.exit(1); }
// eslint-disable-next-line no-eval
const TARGETS = eval('(' + m[1] + ')');

// Reverse the targets map by hostname: the page's own canonical link names its vertical.
const BY_HOST = {};
for (const [key, url] of Object.entries(TARGETS)) BY_HOST[new URL(url).hostname.replace(/^www\./, '')] = key;

// Fallback only. Longest prefix first so personal-injury is not shadowed.
const PREFIXES = [
  ['personal-injury', 'personal_injury'], ['uscis-medical', 'uscis-medical'],
  ['uscis', 'uscis-medical'], ['dentistry', 'dentistry'],
  ['neuro', 'neuro'], ['trt', 'trt'], ['pi', 'personal_injury'],
];

// Anchor text must NOT contain the visible phrase "request assistance".
// validate_velocity_only_overhaul.js strips the href, then bans that phrase in
// the remaining text: the URL may point at the request surface, but the velocity
// property has to read as editorial rather than as a lead-gen funnel - which for
// YMYL content is what keeps it citable. Follows the repo's existing
// "Find a Provider" CTA convention.
const LABEL = {
  personal_injury: 'Find a personal injury attorney',
  'uscis-medical': 'Find a USCIS civil surgeon',
  dentistry: 'Find a dentist',
  neuro: 'Find a neuropsychological evaluator',
  trt: 'Find a hormone or wellness clinic',
};

// Never written: agent-owned artifact lanes (C1), build output, and utility/legal
// pages where a provider CTA would be inappropriate.
const SKIP_DIR = /^(data|dist|artifacts|reports|staging|templates|node_modules|assets|atlas|glossary|tools)\//;
const SKIP_FILE = /^(404|about|privacy|disclaimer|methodology|terms|contact|index)\.html$/;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.html')) acc.push(path.relative(ROOT, p));
  }
  return acc;
}

const st = { scanned: 0, skipped: 0, already: 0, routed: 0, unmatched: 0, no_anchor: 0 };
const byVertical = {};
const unmatched = [];

for (const rel of walk(ROOT)) {
  if (SKIP_DIR.test(rel) || SKIP_FILE.test(rel)) { st.skipped++; continue; }
  const abs = path.join(ROOT, rel);
  const html = fs.readFileSync(abs, 'utf8');
  st.scanned++;
  if (/request-assistance|next-steps/i.test(html)) { st.already++; continue; }

  // Primary signal: which canonical site does this page already cite?
  let key = null;
  const hosts = [...html.matchAll(/https?:\/\/(?:www\.)?([a-z0-9.-]+\.com)/gi)]
    .map((x) => x[1].toLowerCase()).filter((h) => BY_HOST[h]);
  if (hosts.length) {
    const freq = {};
    for (const h of hosts) freq[h] = (freq[h] || 0) + 1;
    // Most-cited canonical host wins; every page links all five in its footer,
    // so a bare presence check would tie. Frequency separates subject from nav.
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    if (top.length === 1 || top[0][1] > top[1][1]) key = BY_HOST[top[0][0]];
  }
  if (!key) {
    const seg = rel.split('/');
    const hit = PREFIXES.find(([p]) => seg[0] === p || seg[0].startsWith(p + '-') ||
      (seg[0] === 'medium-articles' && seg[1] === p));
    if (hit) key = hit[1];
  }
  if (!key || !TARGETS[key]) { st.unmatched++; unmatched.push(rel); continue; }

  const block = `<section class="conversion-route" data-conversion-route="${key}"><h2>Next step</h2>` +
    `<p><a class="primary" href="${TARGETS[key]}">${LABEL[key]}</a> through the official guide ` +
    `for this area, where you can describe your situation and be matched with a provider.</p></section>`;

  let out;
  if (/<\/article>/i.test(html)) out = html.replace(/<\/article>/i, `${block}</article>`);
  else if (/<\/main>/i.test(html)) out = html.replace(/<\/main>/i, `${block}</main>`);
  else if (/<\/body>/i.test(html)) out = html.replace(/<\/body>/i, `${block}</body>`);
  else { st.no_anchor++; continue; }

  st.routed++;
  byVertical[key] = (byVertical[key] || 0) + 1;
  if (!DRY) fs.writeFileSync(abs, out);
}

console.log(`[conversion-routing]${DRY ? ' DRY-RUN' : ''} ` + Object.entries(st).map(([k, v]) => `${k}=${v}`).join(' '));
for (const [k, v] of Object.entries(byVertical).sort((a, b) => b[1] - a[1])) console.log(`   ${k} -> ${TARGETS[k]}  (${v})`);
if (unmatched.length) { console.log('   UNMATCHED:'); unmatched.slice(0, 20).forEach((u) => console.log('     ' + u)); }
