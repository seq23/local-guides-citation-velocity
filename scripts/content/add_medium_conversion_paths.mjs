#!/usr/bin/env node
// Give the 14 authored medium-articles a conversion path.
//
// These are authored source files, not generated output - the build reads them
// and never rewrites them, which is why the generator-side conversion fix that
// corrected 2,309 CTAs never reached them. They link to a canonical guide hub
// (hormonesivhair.com/guides/are-peptides-safe/) rather than the request
// surface, so a reader arriving from an answer engine lands on another article.
//
// The per-vertical destinations are read from velocity_content_release.js, the
// single source of truth, rather than copied - a drifted copy would send a
// dentistry reader to a TRT clinic.
//
// Idempotent. --dry-run to inspect.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry-run');

const src = fs.readFileSync(path.join(ROOT, 'scripts/velocity_content_release.js'), 'utf8');
const m = src.match(/const targets\s*=\s*(\{[\s\S]*?\});/);
if (!m) { console.error('cannot read targets map'); process.exit(1); }
// eslint-disable-next-line no-eval
const TARGETS = eval(`(${m[1]})`);

const VERTICAL = { dentistry: 'dentistry', neuro: 'neuro', pi: 'personal_injury', trt: 'trt', uscis: 'uscis-medical' };
const LABEL = {
  dentistry: 'Find a dentist', neuro: 'Find a neuropsychological evaluator',
  personal_injury: 'Find a personal injury attorney', trt: 'Find a hormone or wellness clinic',
  'uscis-medical': 'Find a USCIS civil surgeon',
};

const root = path.join(ROOT, 'medium-articles');
let changed = 0, already = 0, skipped = 0;
for (const vert of fs.readdirSync(root)) {
  const key = VERTICAL[vert];
  const dest = key && TARGETS[key];
  if (!dest) { skipped += 1; continue; }
  const vdir = path.join(root, vert);
  if (!fs.statSync(vdir).isDirectory()) continue;
  for (const slug of fs.readdirSync(vdir)) {
    const file = path.join(vdir, slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    if (/request-assistance/.test(html)) { already += 1; continue; }
    // Anchor text must not read "request assistance": the velocity property has
    // to stay editorial, which validate_velocity_only_overhaul.js enforces by
    // banning that phrase in visible copy while allowing it in the href.
    const block = `<section class="conversion-route" data-conversion-route="${key}">`
      + `<h2>Next step</h2><p><a class="primary" href="${dest}">${LABEL[key]}</a>`
      + ` through the official guide for this area, where you can describe your situation`
      + ` and be matched with a provider.</p></section>`;
    let out;
    if (/<\/article>/i.test(html)) out = html.replace(/<\/article>/i, `${block}</article>`);
    else if (/<\/main>/i.test(html)) out = html.replace(/<\/main>/i, `${block}</main>`);
    else if (/<\/body>/i.test(html)) out = html.replace(/<\/body>/i, `${block}</body>`);
    else { skipped += 1; continue; }
    if (!DRY) fs.writeFileSync(file, out);
    changed += 1;
  }
}
console.log(`[medium-conversion]${DRY ? ' DRY-RUN' : ''} added=${changed} already=${already} skipped=${skipped}`);
