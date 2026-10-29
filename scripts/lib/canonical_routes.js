'use strict';
/**
 * Canonical route resolver: every link a velocity insight page makes into a
 * canonical guide site must land on a route that site actually publishes.
 *
 * 16 Oct 2026, confirmed by curl: ~3,600 insights links pointed at 31 canonical
 * URLs that 404 (neuroevalguides.com/neuro/, hormonesivhair.com/trt/,
 * dentistryguides.com/dentistry/<intent>/, uscisexam.com/uscis-medical/, ...).
 * They were minted from the velocity site's own hub layout
 * (`${domain}/${basePath}/${cluster}/`) - routes that exist on
 * theindustryguides.com but never on the canonicals. A few more 301'd.
 *
 * Owner rule (13 Oct 2026): the canonical holds the guides + FAQ; velocity pages
 * link to the canonical's real guides at every turn. So a dead hub is mapped to
 * the canonical guide that matches the piece's topic (cluster + title), and only
 * falls back to the canonical's /guides/ index when no guide fits.
 *
 * Route truth is data/canonical_route_snapshot.json (each canonical sitemap's URL
 * set), refreshed by scripts/refresh_canonical_route_snapshot.js and enforced on
 * the rendered insights by scripts/validate_canonical_domains.js.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SNAPSHOT_PATH = path.join(ROOT, 'data', 'canonical_route_snapshot.json');
const CANONICAL_ROUTE_DOMAINS = [
  'theaccidentguides.com',
  'dentistryguides.com',
  'hormonesivhair.com',
  'neuroevalguides.com',
  'uscisexam.com',
  'memphisseniorcarehomes.com'
];
const CANONICAL_HREF_RE = /href="(https?:\/\/(?:www\.)?(?:theaccidentguides|dentistryguides|hormonesivhair|neuroevalguides|uscisexam|memphisseniorcarehomes)\.com(?:[\/?#][^"]*)?)"/g;

let snapshotCache = null;
function loadSnapshot() {
  if (snapshotCache) return snapshotCache;
  const raw = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const routes = {};
  for (const domain of CANONICAL_ROUTE_DOMAINS) {
    const list = (raw.domains || {})[domain];
    if (!Array.isArray(list) || !list.length) throw new Error(`canonical route snapshot has no routes for ${domain}; run node scripts/refresh_canonical_route_snapshot.js`);
    routes[domain] = new Set(list);
  }
  snapshotCache = { generated_at: raw.generated_at, routes };
  return snapshotCache;
}

/**
 * 301s the canonical sites answer today (curl, 16 Oct 2026): link the final URL.
 */
const REDIRECT_FINAL = {
  'theaccidentguides.com/personal-injury/process-timeline/': '/guides/what-to-do-after-an-accident/',
  'theaccidentguides.com/personal-injury/settlement-offers/': '/guides/what-a-fair-settlement-figure-is-made-of/',
  'uscisexam.com/uscis-medical/cost/': '/guides/uscis-medical-exam-cost/',
  'uscisexam.com/uscis-medical/delays-rfe/': '/guides/uscis-fees-timelines-and-what-to-ask/',
  'uscisexam.com/uscis-medical/process-documents/': '/guides/document-checklist/'
};

/**
 * Topic rules per canonical domain, tried in order; first match wins.
 * t(re) tests the piece's title, c(re) tests its cluster (the intent hub it was
 * filed under). The last rule of each domain is its fallback.
 */
const G = (slug) => `/guides/${slug}/`;
const t = (re, target) => ({ re, on: 'title', target });
const c = (re, target) => ({ re, on: 'cluster', target });
const ANY = { re: /^/, on: 'title' };
const TOPIC_RULES = {
  'neuroevalguides.com': [
    // Therapy pieces (ADHD / autism therapy selection, after-evaluation, fit).
    t(/adhd.*progress|progress.*adhd/, G('what-progress-looks-like-in-adhd-therapy')),
    t(/adhd.*(same provider|testing and therapy|evaluation and therapy)/, G('can-one-provider-handle-adhd-evaluation-and-therapy')),
    t(/adhd.*coach/, G('adhd-therapy-vs-medication-vs-coaching')),
    t(/(questions?|ask).*adhd therapist/, G('questions-to-ask-an-adhd-therapist')),
    t(/adhd (diagnosis|testing|evaluation report)|after an adhd/, G('adhd-therapy-after-an-evaluation')),
    t(/adhd.*therap|therap.*adhd/, G('how-to-find-an-adhd-therapist-who-fits')),
    t(/(home|center|school|clinic).based/, G('how-to-choose-between-home-based-center-based-and-school-based-autism-therapy')),
    t(/red flags? in an aba|remote supervision|bcba|new therapists/, G('autism-therapy-red-flags-and-green-flags')),
    t(/(aba|autism).*(questions?|ask|parent training)|(questions?|ask).*(aba|autism)|parent training/, G('questions-to-ask-an-autism-therapy-provider')),
    t(/after an autism|diagnosed with autism|autism diagnosis|autism evaluation (and|to) therap|adults get autism therapy|one clinic/, G('autism-therapy-after-an-evaluation')),
    c(/^adhd-therapy-selection$/, G('how-to-find-an-adhd-therapist-who-fits')),
    c(/^autism-therapy-selection$/, G('questions-to-ask-an-autism-therapy-provider')),
    c(/^therapy-red-flags-and-fit$/, G('autism-therapy-red-flags-and-green-flags')),
    c(/^therapy-after-evaluation$/, G('what-to-expect-after-a-neuro-evaluation')),
    t(/therapy after (testing|diagnosis)|therapy provider after/, G('what-to-expect-after-a-neuro-evaluation')),
    // Evaluation pieces.
    t(/insurance/, G('neuro-insurance-and-out-of-network')),
    t(/cost|price|estimate|wasted money|afford/, G('neuropsychological-evaluation-cost')),
    c(/^cost-timeline$/, G('neuropsychological-evaluation-cost')),
    t(/red flag/, G('neuro-provider-red-flags')),
    t(/telehealth|remote/, G('telehealth-vs-in-person-neuro')),
    t(/report/, G('what-a-neuro-report-includes')),
    t(/accommodation|school|iep|\bwork\b/, G('using-results-for-school-or-work')),
    t(/adults? vs kids|children vs adults|child neuropsych/, G('neuropsych-testing-children-vs-adults')),
    t(/after an evaluation|results are/, G('what-to-expect-after-a-neuro-evaluation')),
    c(/^trust-questions$/, G('questions-to-ask-before-neuro-testing')),
    t(/intake|referral|records|second opinion|deadline|verify|questions?/, G('questions-to-ask-before-neuro-testing')),
    t(/autism evaluation for adult|adult autism/, G('autism-evaluation-adults')),
    t(/autism/, G('autism-evaluations-screening-vs-assessment')),
    t(/adhd/, G('adhd-evaluations-what-to-expect')),
    t(/expect|session|testing day|prepare|comprehensive|memory|concussion/, G('neuropsych-testing-overview')),
    c(/^situations$/, G('neuropsych-testing-overview')),
    { ...ANY, target: G('how-to-choose-a-neuro-evaluation-provider') }
  ],
  'hormonesivhair.com': [
    // Do not send vitamin C / hydration searches to the testosterone
    // injections-versus-gels guide merely because their title says "injection".
    // This is the canonical educational IV/ingredient guide; local clinic
    // prices remain on the canonical site, not in the velocity directory.
    t(/vitamin c|iv hydration|iv drip|hydration (?:drip|therapy)|intravenous (?:hydration|vitamin)/, G('iv-hydration-therapy-overview')),
    t(/peptide.*(bad fit|red flag)/, G('peptide-clinic-red-flags')),
    t(/peptides? vs trt/, G('peptides-vs-trt')),
    t(/peptide/, G('peptide-clinic-near-me')),
    t(/prp.*microneedling|microneedling.*prp/, G('prp-hair-vs-microneedling')),
    t(/prp/, G('what-is-prp-hair-treatment')),
    t(/minoxidil|finasteride|dht/, G('dht-hair-loss-explained')),
    t(/hair.*(trt|testosterone)|(trt|testosterone).*hair/, G('testosterone-and-hair-loss-explained')),
    t(/hair|transplant|\bfue\b|laser cap|dermatologist|before\/after/, G('hair-loss-aesthetic-vs-hormonal')),
    c(/^hair-loss-(cost|provider)$/, G('hair-loss-aesthetic-vs-hormonal')),
    t(/fertility/, G('trt-fertility-and-family-planning')),
    t(/sleep/, G('trt-sleep-fatigue-checklist')),
    t(/injection|\bgels?\b/, G('trt-injections-vs-gels')),
    t(/telehealth|online/, G('trt-telehealth-vs-local-clinic')),
    t(/insurance|coverage|out-of-pocket/, G('does-insurance-cover-testosterone-therapy')),
    t(/cost|price|pricing|quote|fee|cash pay|subscription|pay for|low-cost/, G('trt-pricing-and-labs')),
    c(/^cost-insurance$/, G('trt-pricing-and-labs')),
    t(/red flag|scam|upsell|credential|legit|switch/, G('trt-red-flags')),
    t(/side effect|safety|safe|blood pressure|contraindication|bloodwork|labs|monitor/, G('trt-side-effects-and-safety')),
    c(/^safety-red-flags$/, G('trt-red-flags')),
    t(/endocrinologist|primary care|candidate/, G('who-is-a-good-candidate-for-trt')),
    t(/near me|compare|choose|clinic|provider/, G('hormone-replacement-therapy-near-me')),
    c(/^best-top-near-me$/, G('hormone-replacement-therapy-near-me')),
    { ...ANY, target: G('testosterone-replacement-therapy-overview') }
  ],
  'dentistryguides.com': [
    t(/second opinion|unnecessary treatment/, G('dental-second-opinion')),
    c(/^second-opinion$/, G('dental-second-opinion')),
    t(/sedation|anxiety|anxious|fear|gentle/, G('sedation-dentistry')),
    c(/^(anxiety-trust|sedation-fear)$/, G('sedation-dentistry')),
    t(/emergency|open now|open saturday|appointment today|same day|urgent|tooth pain|infection/, G('emergency-dentist-vs-waiting')),
    c(/^emergency-open-now$/, G('emergency-dentist-vs-waiting')),
    t(/insurance|in.network|out-of-network|medicare/, G('dental-insurance-coverage-explained')),
    t(/implant.*(cost|price|estimate|financ|worth)|(cost|price).*implant/, G('dental-implant-and-oral-surgery-cost')),
    t(/implant/, G('dental-implants')),
    t(/invisalign|braces|aligner/, G('clear-aligners')),
    t(/root.canal/, G('root-canal-treatment')),
    t(/extraction|wisdom teeth/, G('tooth-extractions')),
    t(/cost|price|pricing|financ|itemized|estimate/, G('cost-financing')),
    c(/^(cost-insurance|cost-financing)$/, G('cost-financing')),
    t(/red flag|scam|reviews/, G('dental-red-flags')),
    t(/specialist|oral surgeon|endodontist/, G('oral-surgery')),
    c(/^specialists$/, G('oral-surgery')),
    { ...ANY, target: G('how-to-choose') }
  ],
  'uscisexam.com': [
    t(/cost|price|fee/, G('uscis-medical-exam-cost')),
    t(/vaccin|\btb\b/, G('uscis-vaccination-requirements')),
    t(/rfe|delay|deadline|mistake|correction|valid/, G('uscis-fees-timelines-and-what-to-ask')),
    t(/envelope|seal|i-693/, G('i-693-form-instructions')),
    t(/document|records|translation|night before|paperwork/, G('document-checklist')),
    t(/civil surgeon|authorized|near me|compare|walk.in|same.week|same.day|clinic/, G('questions-to-ask-a-civil-surgeon')),
    c(/^civil-surgeon-near-me$/, G('questions-to-ask-a-civil-surgeon')),
    { ...ANY, target: G('uscis-medical-exam-overview') }
  ],
  'theaccidentguides.com': [
    t(/fee|cost/, G('personal-injury-fees-explained')),
    c(/^cost-fees$/, G('personal-injury-fees-explained')),
    t(/red flag/, G('personal-injury-lawyer-red-flags')),
    c(/^trust-red-flags$/, G('personal-injury-lawyer-red-flags')),
    t(/insurance|fault|recorded statement/, G('recorded-statements-and-insurance-calls')),
    c(/^insurance-fault$/, G('recorded-statements-and-insurance-calls')),
    t(/settlement/, G('what-a-fair-settlement-figure-is-made-of')),
    t(/wrongful.death/, G('wrongful-death')),
    t(/workers comp|workplace/, G('workplace-injuries')),
    t(/slip and fall|grocery/, G('slip-and-fall')),
    t(/car accident|crash|parking lot/, G('car-accidents')),
    t(/medical|treatment|injuries showed up/, G('medical-bills-behind-a-settlement')),
    c(/^medical-treatment$/, G('medical-bills-behind-a-settlement')),
    t(/lawyer|attorney|near me/, G('questions-to-ask-a-personal-injury-lawyer')),
    c(/^best-top-near-me$/, G('questions-to-ask-a-personal-injury-lawyer')),
    { ...ANY, target: G('what-to-do-after-an-accident') }
  ],
  'memphisseniorcarehomes.com': [
    t(/licens|inspection/, G('tennessee-assisted-living-inspection-records')),
    t(/pay|cost|tenncare/, G('how-families-pay-for-assisted-living')),
    t(/choose/, G('how-to-choose-a-senior-care-home-memphis')),
    { ...ANY, target: '/guides/' }
  ]
};

function normalizePath(p) {
  let s = p || '/';
  if (!s.startsWith('/')) s = `/${s}`;
  if (!s.endsWith('/') && !/\.[a-z0-9]+$/i.test(s)) s = `${s}/`;
  return s;
}

function parseCanonical(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (!CANONICAL_ROUTE_DOMAINS.includes(host)) return null;
  return { host, path: normalizePath(u.pathname), rawPath: u.pathname || '/', search: u.search, hash: u.hash };
}

/** True when the URL's path is a route its canonical site publishes. */
function isLiveCanonicalRoute(url) {
  const p = parseCanonical(url);
  if (!p) return false;
  const { routes } = loadSnapshot();
  return routes[p.host].has(p.path) && p.rawPath === p.path;
}

/**
 * Resolve a canonical URL to a live route. A URL already in the snapshot is
 * returned unchanged (bare origins become `<origin>/`); anything else is routed
 * by topic. Throws when no live route can be named - never ships a guess.
 */
function resolveCanonicalTarget(url, ctx = {}) {
  const p = parseCanonical(url);
  if (!p) return url;
  const { routes } = loadSnapshot();
  const origin = `https://${p.host}`;
  if (routes[p.host].has(p.path)) return `${origin}${p.path}${p.search}${p.hash}`;
  const redirected = REDIRECT_FINAL[`${p.host}${p.path}`];
  if (redirected) {
    if (!routes[p.host].has(redirected)) throw new Error(`redirect target ${p.host}${redirected} is not in its sitemap snapshot`);
    return `${origin}${redirected}`;
  }
  const title = String(ctx.title || '').toLowerCase();
  const cluster = String(ctx.cluster || '').toLowerCase();
  for (const rule of TOPIC_RULES[p.host] || []) {
    if (!rule.re.test(rule.on === 'cluster' ? cluster : title)) continue;
    if (!routes[p.host].has(rule.target)) throw new Error(`canonical route rule for ${p.host} names ${rule.target}, which is not in its sitemap snapshot`);
    return `${origin}${rule.target}`;
  }
  throw new Error(`no live canonical route for ${url} (cluster ${ctx.cluster}, title ${ctx.title})`);
}

/** Rewrite every canonical-domain href in rendered HTML through the resolver. */
function rewriteCanonicalHrefs(html, ctx = {}) {
  return String(html).replace(CANONICAL_HREF_RE, (m, href) => {
    const decoded = href.replace(/&amp;/g, '&');
    const resolved = resolveCanonicalTarget(decoded, ctx);
    return resolved === decoded ? m : `href="${resolved.replace(/&/g, '&amp;')}"`;
  });
}

/** Every canonical-domain href in the HTML, as written. */
function canonicalHrefs(html) {
  return [...String(html).matchAll(CANONICAL_HREF_RE)].map((m) => m[1].replace(/&amp;/g, '&'));
}

module.exports = {
  SNAPSHOT_PATH,
  CANONICAL_ROUTE_DOMAINS,
  TOPIC_RULES,
  REDIRECT_FINAL,
  loadSnapshot,
  isLiveCanonicalRoute,
  resolveCanonicalTarget,
  rewriteCanonicalHrefs,
  canonicalHrefs
};
