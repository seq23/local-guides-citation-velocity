#!/usr/bin/env node
// WO-9. This corpus carried zero author attribution. Google's March 2026 update
// named unattributed programmatic YMYL specifically.
//
// Attribution uses the byline this repo already declares in
// data/authority/reviewer_registry.json. That registry states: "Only real people
// with independently verifiable credentials, explicit approval, defined review
// scope, and recheck dates may be published as individual reviewers", and supplies
// an Organization fallback_byline for everything else. So pages are attributed to
// the editorial Organization, NOT to an individual - naming a person here would
// both violate that governance and imply a credential nobody has verified (C3).
//
// Clinical pages additionally declare that credentialed review is outstanding.
// Idempotent. --dry-run, --limit N.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const li = args.indexOf('--limit');
const LIMIT = li >= 0 ? Number(args[li + 1]) : Infinity;

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/authority/reviewer_registry.json'), 'utf8'));
const BYLINE = registry.fallback_byline;
if (!BYLINE?.name || !BYLINE?.url) { console.error('reviewer_registry.fallback_byline missing name/url'); process.exit(1); }
const ORG_ID = 'https://theindustryguides.com/#editorial-team';
const AUTHOR_NODE = { '@type': 'Organization', '@id': ORG_ID, name: BYLINE.name, url: BYLINE.url };
const MARK = ORG_ID;

const CLINICAL = /((^|[/-])trt([/-]|$)|medical|ssdi|iep-eval|forensic-eval|neuro|dental|dentist|implant|endodont|periodont|orthodont|oral-surge|root-canal|veneer|denture|invisalign|braces|aligner|whitening|wisdom-tooth|cavity|filling|crown|sedation|anesthes|extraction|gum-|hormone|testosteron|estrogen|menopause|hrt-|thyroid|semaglutide|ozempic|peptide|weight-loss|hair-loss|iv-therapy|adhd|autism|cognitive-assess|psychiat|psycholog|civil-surgeon|panel-physician|vaccinat|immuniz|i-693|surgeon|surgery|clinic|physician|doctor|dermat|botox|filler|therapy|treatment-plan)/i;

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
  if (st.attributed >= LIMIT) break;
  const rel = path.relative(ROOT, abs);
  let html = fs.readFileSync(abs, 'utf8');
  st.scanned++;
  if (html.includes(MARK)) { st.already++; continue; }
  if (/<meta[^>]+name=["']robots["'][^>]*noindex/i.test(html)) { st.skipped_noindex++; continue; }
  if (!/application\/ld\+json/i.test(html)) { st.no_jsonld++; continue; }

  // Classify on the URL slug. Body prose is unusable: accident and legal pages
  // routinely say treatment, patient and therapy without being clinical.
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
      n.author = { '@id': ORG_ID };
      if (isClinical) { n.reviewer_required = true; n.reviewer_status = 'PENDING_CREDENTIALED_REVIEWER'; }
    }
    if (!nodes.some(n => n && n['@id'] === ORG_ID)) nodes.push(AUTHOR_NODE);
    done = true;
    const out = isG ? { ...d, '@graph': nodes } : (Array.isArray(d) ? nodes : { '@context':'https://schema.org', '@graph': nodes });
    return `${o}${JSON.stringify(out)}${c}`;
  });
  if (bad) { st.unparseable++; continue; }
  if (!done) continue;

  if (!/<meta[^>]+name=["']author["']/i.test(html) && /<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, `  <meta name="author" content="${BYLINE.name}">\n</head>`);
    st.meta_added++;
  }
  if (isClinical) {
    if (!/data-ymyl-reviewer-required/.test(html) && /<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, '  <meta name="ymyl-review-status" content="pending-credentialed-reviewer" data-ymyl-reviewer-required="true">\n</head>');
    }
    st.clinical_flagged++;
  }
  st.attributed++;
  ledger.push({ path: rel, byline: BYLINE.name, lane: isClinical ? 'clinical' : 'non_clinical', ...(isClinical ? { reviewer_status: 'PENDING_CREDENTIALED_REVIEWER' } : {}) });
  if (!DRY) fs.writeFileSync(abs, html);
}

if (!DRY && ledger.length) {
  fs.mkdirSync(path.join(ROOT, 'data/governance'), { recursive: true });
  const p = path.join(ROOT, 'data/governance/ymyl_attribution_ledger.json');
  const prev = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { entries: [] };
  const seen = new Set(prev.entries.map(e => e.path));
  prev.entries.push(...ledger.filter(e => !seen.has(e.path)));
  prev.schema_version = '1.0'; prev.generated_at = new Date().toISOString();
  fs.writeFileSync(p, JSON.stringify(prev, null, 2) + '\n');
}
console.log(`[ymyl-attribution]${DRY ? ' DRY-RUN' : ''} ` + Object.entries(st).map(([k,v]) => `${k}=${v}`).join(' '));
