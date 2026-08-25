#!/usr/bin/env node
// Mark the existing lead paragraph of each medium article as its direct answer.
//
// These pages already open with a self-contained summary - "What to actually ask
// before starting a peptide program, and the red flags most clinics hope you
// won't notice." It was never marked up, so extraction had nothing to grab and
// the content-pattern contract counted the page as having no quotable answer.
//
// This is markup of content that exists. It does not write or reword copy.
// Idempotent; --dry-run to inspect.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DRY = process.argv.includes('--dry-run');
const root = path.join(ROOT, 'medium-articles');
const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

let marked = 0, already = 0, noLead = 0;
for (const vert of fs.readdirSync(root)) {
  const vdir = path.join(root, vert);
  if (!fs.statSync(vdir).isDirectory()) continue;
  for (const slug of fs.readdirSync(vdir)) {
    const file = path.join(vdir, slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    if (/data-direct-answer=/.test(html)) { already += 1; continue; }

    // First substantive paragraph that is not the editorial byline.
    const paras = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
    const lead = paras.find((m) => {
      const t = strip(m[1]);
      return t.length > 60 && !/Editorial Team/i.test(t);
    });
    if (!lead) { noLead += 1; continue; }

    const wrapped = `<section class="card answer-box" data-direct-answer="true">`
      + `<div class="badge">Direct answer</div><p>${lead[1]}</p></section>`;
    const out = html.slice(0, lead.index) + wrapped + html.slice(lead.index + lead[0].length);
    if (!DRY) fs.writeFileSync(file, out);
    marked += 1;
  }
}
console.log(`[medium-direct-answer]${DRY ? ' DRY-RUN' : ''} marked=${marked} already=${already} no_lead=${noLead}`);
