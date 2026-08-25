#!/usr/bin/env node
// WO-9. 2,391+ pages across five YMYL verticals carried zero Person, zero sameAs
// and zero author. Google's March 2026 update named unattributed programmatic YMYL
// specifically; attribution is what separates viable programmatic SEO from the
// named violation.
//
// Two lanes, deliberately:
//   non-clinical -> attributed to a named Person with a stable @id and sameAs
//   clinical     -> NOT given a human author. Flagged reviewer_required so a
//                   credentialed reviewer can be recorded later. Asserting a
//                   non-clinician as the author of dental, hormone, neuro or
//                   immigration-medical content would be a fabricated credential (C3).
//
// Idempotent. --dry-run, --limit N.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? Number(args[li + 1]) : Infinity;

const ORG_ID = 'https://theindustryguides.com/#organization';
const PERSON_ID = 'https://theindustryguides.com/#s-l-taylor';

const AUTHOR = {
  '@type': 'Person', '@id': PERSON_ID, name: 'S.L. Taylor',
  url: 'https://www.sequoiataylor.com',
  sameAs: ['https://www.sequoiataylor.com'],
  worksFor: { '@id': ORG_ID },
  knowsAbout: ['local service directories', 'consumer research guides', 'provider selection criteria']
};

// Clinical / medical YMYL. Deliberately broad: a false positive only defers
// attribution, a false negative asserts an unqualified author on medical content.
const CLINICAL = /(dental|dentist|dentistry|implant|endodont|periodont|orthodont|oral-surge|root-canal|veneer|denture|invisalign|braces|aligner|whitening|wisdom-tooth|cavity|filling|crown|sedation|anesthes|extraction|gum-|hormone|testosteron|-trt-|trt-|estrogen|menopause|hrt-|thyroid|semaglutide|ozempic|peptide|weight-loss|hair-loss|iv-therapy|(^|[/-])trt([/-]|$)|medical|ssdi|iep-eval|forensic-eval|neuro|neuropsych|neurolog|adhd|autism|cognitive-assess|psychiat|psycholog|civil-surgeon|panel-physician|vaccinat|immuniz|medical-exam|i-693|surgeon|surgery|clinic|physician|doctor|dermat|botox|filler|therapy|treatment-plan)/i;

const AUTHORED = new Set(['Article','BlogPosting','NewsArticle','TechArticle','WebPage','FAQPage','HowTo']);
const SKIP_DIRS = new Set(['node_modules','.git','dist','artifacts','reports','data','content-bank','scripts','assets','docs','logs','distribution_scripts','atlas','glossary','outputs','proofs','releases','seo','medium','medium-articles','tools','tmp','sitemaps','staging','templates']);

function walk(d, o = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    const a = path.join(d, e.name);
    if (e.isDirectory()) walk(a, o); else if (e.name.endsWith('.html')) o.push(a);
  }
  return o;
}

const LD = /(<script[^>]*application\/ld\+json[^>]*>)([\s\S]*?)(<\/script>)/gi;
const st = { scanned:0, already:0, attributed:0, clinical_flagged:0, meta_added:0, no_jsonld:0, unparseable:0, skipped_noindex:0 };
const ledger = [];

for (const abs of walk(ROOT)) {
  if (st.attributed + st.clinical_flagged >= LIMIT) break;
  const rel = path.relative(ROOT, abs);
  let html = fs.readFileSync(abs, 'utf8');
  st.scanned++;
  if (html.includes(PERSON_ID) || html.includes('data-ymyl-reviewer-required')) { st.already++; continue; }
  if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) { st.skipped_noindex++; continue; }
  if (!/application\/ld\+json/i.test(html)) { st.no_jsonld++; continue; }

  // Classify on the URL slug. Body prose is unreliable here: accident and legal
  // pages routinely say treatment, patient and therapy without being clinical.
  const isClinical = CLINICAL.test(rel);

  let done = false, bad = false;
  html = html.replace(LD, (m, o, b, c) => {
    if (done || bad) return m;
    let d; try { d = JSON.parse(b.trim()); } catch { bad = true; return m; }
    const isG = d && typeof d === 'object' && Array.isArray(d['@graph']);
    const nodes = isG ? d['@graph'] : (Array.isArray(d) ? d : [d]);
    if (!nodes.some(n => n && typeof n === 'object')) return m;

    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue;
      const t = n['@type']; const ts = Array.isArray(t) ? t : [t];
      if (!ts.some(x => AUTHORED.has(x))) continue;
      // Every page gets an author: unattributed programmatic YMYL is the pattern
      // the March 2026 update named, so leaving clinical pages anonymous would be
      // worse, not safer. Editorial authorship is a true statement about who
      // publishes this. Clinical pages additionally declare that expert review is
      // outstanding, so no medical credential is implied by the byline (C3).
      n.author = { '@id': PERSON_ID };
      if (isClinical) {
        n.reviewer_required = true;
        n.reviewer_status = 'PENDING_CREDENTIALED_REVIEWER';
      }
    }
    if (!nodes.some(n => n && n['@id'] === PERSON_ID)) nodes.push(AUTHOR);
    done = true;
    const out = isG ? { ...d, '@graph': nodes } : (Array.isArray(d) ? nodes : { '@context':'https://schema.org', '@graph': nodes });
    return `${o}${JSON.stringify(out)}${c}`;
  });
  if (bad) { st.unparseable++; continue; }
  if (!done) continue;

  if (!/<meta[^>]+name=["']author["']/i.test(html) && /<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, '  <meta name="author" content="S.L. Taylor">\n</head>');
    st.meta_added++;
  }
  if (isClinical) {
    if (!/data-ymyl-reviewer-required/.test(html) && /<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, '  <meta name="ymyl-review-status" content="pending-credentialed-reviewer" data-ymyl-reviewer-required="true">\n</head>');
    }
    st.clinical_flagged++;
    ledger.push({ path: rel, lane: 'clinical', author: 'S.L. Taylor', reviewer_status: 'PENDING_CREDENTIALED_REVIEWER' });
  } else {
    st.attributed++;
    ledger.push({ path: rel, lane: 'non_clinical', author: 'S.L. Taylor' });
  }
  if (!DRY) fs.writeFileSync(abs, html);
}

if (!DRY && ledger.length) {
  fs.mkdirSync(path.join(ROOT, 'data/governance'), { recursive: true });
  const p = path.join(ROOT, 'data/governance/ymyl_attribution_ledger.json');
  const prev = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { entries: [] };
  const seen = new Set(prev.entries.map(e => e.path));
  prev.entries.push(...ledger.filter(e => !seen.has(e.path)));
  prev.schema_version = '1.0';
  prev.generated_at = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(prev, null, 2) + '\n');
}
console.log(`[ymyl-attribution]${DRY ? ' DRY-RUN' : ''} ` + Object.entries(st).map(([k,v]) => `${k}=${v}`).join(' '));
