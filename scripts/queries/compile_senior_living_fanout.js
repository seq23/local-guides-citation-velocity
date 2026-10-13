#!/usr/bin/env node
'use strict';
/**
 * Senior-living query fan-out: query -> Velocity piece -> canonical route.
 *
 * The canonical site (memphisseniorcarehomes.com, built by local-guides-generator)
 * owns the full answers. This repo compiles the hyperlocal query universe for the
 * Memphis Tri-State into data/queries/senior_living_fanout_compiled.json. Every
 * compiled query is assigned to exactly one of the eight Velocity senior-living
 * pieces (which renders it as a short answered question) and exactly one canonical
 * route that owns the full answer (a city page or a guide). No page is created per
 * query: the universe lives here and as question sets on the eight pieces.
 *
 * Sources, merged and de-duplicated by normalized query:
 *   1. the canonical site's own fan-out (dist/_fanout_query_clusters.json, the seam
 *      the other verticals' generator fan-out files use): --source <path|url>, else
 *      $SENIOR_FANOUT_SOURCE, else the live https://memphisseniorcarehomes.com/
 *      _fanout_query_clusters.json. Unreachable -> recorded, not fatal; only items
 *      whose href is a known canonical route and whose query is about senior care
 *      are kept.
 *   2. the head-phrase x locality x modifier grid below (deterministic).
 *
 * Canonical routes come from data/contracts/senior_living_canonical_routes.json,
 * refreshed with --routes-from <local-guides-generator checkout> (reads the city
 * list and global page files the canonical build renders). Fails before write if
 * any compiled query routes outside that list or a locality ends up with none.
 *
 * Usage: node scripts/queries/compile_senior_living_fanout.js [--source X] [--routes-from DIR]
 */
const fs = require('fs');
const path = require('path');
const { normalizeQuery } = require('../normalize_queries');

const ROOT = path.resolve(__dirname, '..', '..');
const ROUTES_REL = 'data/contracts/senior_living_canonical_routes.json';
const OUT_REL = 'data/queries/senior_living_fanout_compiled.json';
const LIVE = 'https://memphisseniorcarehomes.com/_fanout_query_clusters.json';
const P = (s) => `/senior-living/${s}/`;
const PIECE = {
  types: P('assisted-living-vs-memory-care-vs-senior-care-home-tennessee'),
  cost: P('assisted-living-cost-memphis-germantown-collierville-bartlett-southaven'),
  move_ms: P('moving-a-parent-from-memphis-to-olive-branch-or-southaven'),
  payers: P('tenncare-choices-vs-mississippi-medicaid-vs-private-pay'),
  tn_ar: P('west-tennessee-vs-east-arkansas-senior-living-licensing'),
  va: P('va-aid-and-attendance-assisted-living-tennessee'),
  discharge: P('hospital-discharge-to-assisted-living-memphis'),
  beds: P('private-pay-vs-medicaid-beds-memphis')
};

// The 17 localities (plus 4 regions). county/state drive the licensing answer.
const LOCALITIES = [
  ['memphis', 'Memphis', 'memphis-tn', 'TN'], ['east memphis', 'East Memphis', 'east-memphis-tn', 'TN'],
  ['midtown', 'Midtown Memphis', 'memphis-tn', 'TN'], ['downtown', 'Downtown Memphis', 'memphis-tn', 'TN'],
  ['germantown', 'Germantown', 'germantown-tn', 'TN'], ['collierville', 'Collierville', 'collierville-tn', 'TN'],
  ['bartlett', 'Bartlett', 'bartlett-tn', 'TN'], ['cordova', 'Cordova', 'cordova-tn', 'TN'],
  ['arlington', 'Arlington', 'arlington-tn', 'TN'], ['lakeland', 'Lakeland', 'lakeland-tn', 'TN'],
  ['millington', 'Millington', 'millington-tn', 'TN'], ['southaven', 'Southaven', 'southaven-ms', 'MS'],
  ['olive branch', 'Olive Branch', 'olive-branch-ms', 'MS'], ['horn lake', 'Horn Lake', 'horn-lake-ms', 'MS'],
  ['hernando', 'Hernando', 'hernando-ms', 'MS'], ['west memphis', 'West Memphis', 'west-memphis-ar', 'AR'],
  ['marion', 'Marion', 'marion-ar', 'AR']
];
const REGIONS = [
  ['shelby county', 'Shelby County', 'memphis-tn', 'TN'], ['desoto county', 'DeSoto County', 'southaven-ms', 'MS'],
  ['north mississippi', 'North Mississippi', 'southaven-ms', 'MS'], ['mid-south', 'the Mid-South', 'memphis-tn', 'TN']
];
const STATE_NAME = { TN: 'Tennessee', MS: 'Mississippi', AR: 'Arkansas' };
const COUNTY = { TN: 'Shelby County, Tennessee', MS: 'DeSoto County, Mississippi', AR: 'Crittenden County, Arkansas' };
const LICENSE = {
  TN: 'the Tennessee Health Facilities Commission licenses assisted-care living facilities and residential homes for the aged',
  MS: 'the Mississippi State Department of Health licenses personal care homes for assisted living and residential living',
  AR: 'the Arkansas DHS Office of Long Term Care licenses assisted living facilities at Level I or Level II'
};
const HEADS = ['care home', 'senior care home', 'senior living care home', "old people's home", 'retirement home', 'assisted living facility',
  'assisted living', 'memory care facility', 'memory care', 'dementia care', 'personal care home', 'nursing home', 'respite care'];
const MODIFIERS = ['private pay', 'affordable', 'best', 'cost', 'takes medicaid', 'veterans', 'pet friendly', 'christian'];
const MOD_HEADS = ['assisted living', 'care home'];
const GUIDE = (s) => `/guides/${s}/`;

function headFamily(head) {
  if (/memory|dementia/.test(head)) return 'memory';
  if (/nursing/.test(head)) return 'nursing';
  if (/respite/.test(head)) return 'respite';
  return 'general';
}

const MASS = new Set(['assisted living', 'memory care', 'dementia care', 'respite care']);
const an = (w) => (/^[aeiou]/i.test(w) ? 'an' : 'a');
const plural = (h) => h.replace(/facility$/, 'facilities').replace(/home$/, 'homes');
function question(head, mod, place) {
  const where = place ? ` in ${place}` : ' in the Memphis area';
  const mass = MASS.has(head);
  const a = (w) => (mass ? w : `${an(w)} ${w}`);
  switch (mod) {
    case 'private pay': return `How does private pay work for ${a(head)}${where}?`;
    case 'affordable': return `Is there ${a(`affordable ${head}`)}${where}?`;
    case 'best': return `How do I pick the best ${head}${where}?`;
    case 'cost': return `What does ${a(head)} cost${where}?`;
    case 'takes medicaid': return mass ? `Which ${head} communities${where} take Medicaid?` : `Which ${plural(head)}${where} take Medicaid?`;
    case 'veterans': return `Is there ${a(head)} for veterans${where}?`;
    case 'pet friendly': return `Is there ${a(`pet-friendly ${head}`)}${where}?`;
    case 'christian': return `Is there ${a(`Christian ${head}`)}${where}?`;
    default: return `Where can I find ${a(head)}${where}?`;
  }
}

function answer(head, mod, loc) {
  const st = loc ? loc[3] : 'TN';
  const name = loc ? loc[1] : 'the Memphis area';
  switch (mod) {
    case 'cost': case 'affordable':
      return st === 'TN' ? `No public survey publishes a figure for ${name}; Tennessee's 2025 assisted living median was $67,140 a year (CareScout). Compare written quotes for the same apartment and care level.`
        : st === 'MS' ? `No public survey publishes a figure for ${name}; CareScout's 2025 survey ranks Mississippi among the lowest-cost states for assisted living. Compare written quotes, care fee included.`
          : `No public survey publishes a figure for ${name}; ask each community for its full monthly price, care fee included, in writing.`;
    case 'private pay':
      return `Private pay covers rent and care at any ${name} community and can start right away; ask for the base rate, the care-level fee and the rate-increase notice in writing.`;
    case 'takes medicaid':
      return st === 'TN' ? `TennCare CHOICES pays care services, not room and board, and only at communities that contract with TennCare; ask each community in ${name} whether it does.`
        : st === 'MS' ? `In ${name}, Mississippi's Assisted Living Waiver pays care services at licensed Personal Care Home-Assisted Living providers approved by Medicaid; waiting lists are possible.`
          : `In ${name}, Arkansas's Living Choices waiver pays care services only in Level II assisted living facilities enrolled as providers; slots are limited.`;
    case 'veterans':
      return `VA pension with Aid and Attendance can help pay for care in ${name}: from December 1, 2025 the maximum is $29,093 a year for a veteran with no dependents. VA decides eligibility, and an accredited ${COUNTY[st].split(',')[0]} veterans service officer can file the claim free.`;
    case 'best':
      return `Compare the license, the latest state inspection, night staffing and the written price; in ${STATE_NAME[st]}, ${LICENSE[st]}.`;
    case 'pet friendly':
      return `Pet policies are set community by community in ${name}; ask about size limits, fees and who cares for the pet if your parent cannot, and get it in the residency agreement.`;
    case 'christian':
      return `Faith-based programming varies by community in ${name}; ask what services, chaplaincy and transport to church are offered, and whether they are in the monthly price.`;
    default: break;
  }
  switch (headFamily(head)) {
    case 'memory': return `Memory care is dementia care inside a licensed community, often in a secured unit; ask how exits are secured and how night shifts are staffed in ${name}.`;
    case 'nursing': return `A nursing home is a separately licensed skilled-nursing setting; assisted living fits when your parent needs daily help but not daily skilled nursing.`;
    case 'respite': return `Some communities offer short respite stays in a furnished apartment; ask about the minimum stay, the daily rate and what care is included.`;
    default:
      if (loc && loc[0] === 'mid-south') return `The Mid-South spans three licensing systems: ${LICENSE.TN}; ${LICENSE.MS}; ${LICENSE.AR}.`;
      if (loc && /county|mississippi/i.test(loc[1])) return `${loc[1]} is under ${STATE_NAME[st]} licensing: ${LICENSE[st]}.`;
      return `${name} is in ${COUNTY[st]}, where ${LICENSE[st]}.`;
  }
}

function pieceFor(head, mod, loc) {
  const st = loc ? loc[3] : null;
  if (mod === 'veterans') return PIECE.va;
  if (mod === 'private pay') return PIECE.beds;
  if (mod === 'cost' || mod === 'affordable') return PIECE.cost;
  if (mod === 'takes medicaid') return st === 'AR' ? PIECE.tn_ar : PIECE.payers;
  if (st === 'AR') return PIECE.tn_ar;
  if (st === 'MS') return PIECE.move_ms;
  const fam = headFamily(head);
  if (fam === 'nursing' || fam === 'respite') return PIECE.discharge;
  return PIECE.types;
}

function guideFor(head, mod) {
  if (mod === 'cost' || mod === 'affordable') return GUIDE('assisted-living-cost-memphis');
  if (mod === 'takes medicaid') return GUIDE('when-the-money-runs-out-tenncare-choices');
  if (mod === 'private pay' || mod === 'veterans') return GUIDE('how-families-pay-for-assisted-living');
  if (mod === 'pet friendly' || mod === 'christian') return GUIDE('questions-to-ask-on-a-tour');
  const fam = headFamily(head);
  if (fam === 'memory') return GUIDE('memory-care-when-is-it-time');
  if (fam === 'nursing' || fam === 'respite') return GUIDE('levels-of-care-tennessee');
  return GUIDE('how-to-choose-a-senior-care-home-memphis');
}

function grid() {
  const out = [];
  const places = [...LOCALITIES.map((l) => ({ l, region: false })), ...REGIONS.map((l) => ({ l, region: true }))];
  for (const { l, region } of places) {
    for (const head of HEADS) out.push({ head, mod: '', loc: l, region, query: `${head} ${l[0]}` });
    for (const mod of MODIFIERS) for (const head of MOD_HEADS) {
      const query = mod === 'veterans' ? `${head} for veterans ${l[0]}` : mod === 'takes medicaid' ? `${head} that takes medicaid ${l[0]}` : `${mod} ${head} ${l[0]}`;
      out.push({ head, mod, loc: l, region, query });
    }
  }
  for (const head of HEADS) for (const mod of MODIFIERS) {
    const query = mod === 'veterans' ? `${head} for veterans` : mod === 'takes medicaid' ? `${head} that takes medicaid` : `${mod} ${head}`;
    out.push({ head, mod, loc: null, region: false, query });
  }
  return out.map((r) => ({
    query: r.query,
    question: question(r.head, r.mod, r.loc ? r.loc[1] : null),
    answer: answer(r.head, r.mod, r.loc),
    head_phrase: r.head,
    modifier: r.mod || null,
    locality: r.loc && !r.region ? r.loc[0] : null,
    region: r.loc && r.region ? r.loc[0] : null,
    state: r.loc ? r.loc[3] : null,
    canonical_route: r.loc ? `/${r.loc[2]}/` : guideFor(r.head, r.mod),
    canonical_label: labelFor(r.loc ? `/${r.loc[2]}/` : guideFor(r.head, r.mod), r.loc),
    velocity_piece: pieceFor(r.head, r.mod, r.loc),
    source: 'velocity_grid'
  }));
}


// Read head phrase, modifier and place out of a canonical fan-out query so the
// piece answers it with the same sourced sentence the grid uses. A ZIP or an
// unnamed place falls back to the city the canonical site routed it to.
const HEAD_RX = [
  [/memory care facilit/, 'memory care facility'], [/memory care/, 'memory care'], [/dementia/, 'dementia care'],
  [/nursing home/, 'nursing home'], [/respite/, 'respite care'], [/personal care home/, 'personal care home'],
  [/assisted living facilit/, 'assisted living facility'], [/assisted living/, 'assisted living'],
  [/retirement home/, 'retirement home'], [/old people/, "old people's home"], [/senior living care home/, 'senior living care home'],
  [/senior care home/, 'senior care home'], [/care home/, 'care home']
];
const MOD_RX = [
  [/private pay/, 'private pay'], [/afford|cheap|low cost|low-cost/, 'affordable'], [/\bbest\b|\btop\b/, 'best'],
  [/cost|price|how much/, 'cost'], [/medicaid|tenncare|choices/, 'takes medicaid'], [/veteran|\bva\b/, 'veterans'],
  [/pet/, 'pet friendly'], [/christian|church|faith/, 'christian']
];
function parseQuery(q, href) {
  const t = String(q).toLowerCase();
  const head = (HEAD_RX.find(([rx]) => rx.test(t)) || [null, 'care home'])[1];
  const mod = (MOD_RX.find(([rx]) => rx.test(t)) || [null, ''])[1];
  let loc = [...LOCALITIES].sort((a, b) => b[0].length - a[0].length).find((l) => t.includes(l[0]));
  let region = false;
  if (!loc) { loc = REGIONS.find((l) => t.includes(l[0])); region = Boolean(loc); }
  if (!loc) { const m = /^\/([a-z-]+-(tn|ms|ar))\/$/.exec(href); if (m) loc = LOCALITIES.find((l) => l[2] === m[1]); }
  return { head, mod, loc: loc || null, region };
}
function labelFor(href, loc) {
  if (/^\/guides\//.test(href)) return 'Read the full guide';
  if (href === '/') return 'Memphis Senior Care Homes';
  const m = LOCALITIES.find((l) => `/${l[2]}/` === href);
  return m ? `Assisted living and memory care in ${m[1] === 'Midtown Memphis' || m[1] === 'Downtown Memphis' ? 'Memphis' : m[1]}` : 'Read the full answer';
}

async function readCanonicalFanout(src) {
  try {
    let text;
    if (/^https?:\/\//.test(src)) {
      const res = await fetch(src, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) return { status: `unreachable (HTTP ${res.status})`, items: [] };
      text = await res.text();
    } else {
      if (!fs.existsSync(src)) return { status: 'missing', items: [] };
      text = fs.readFileSync(src, 'utf8');
    }
    const doc = JSON.parse(text);
    const items = [];
    for (const rec of doc.records || []) for (const g of rec.groups || []) for (const it of g.items || []) items.push({ query: it.query, href: it.href || rec.route, page_route: rec.route });
    return { status: 'read', items, generated_at: doc.generatedAt || null };
  } catch (e) { return { status: `unreadable (${e.message})`, items: [] }; }
}

function routesFrom(dir) {
  const cities = JSON.parse(fs.readFileSync(path.join(dir, 'data/page_sets/examples/cities_senior_living_v1.json'), 'utf8'));
  const gdir = path.join(dir, 'data/page_sets/examples/senior_living_global_pages');
  const globals = fs.readdirSync(gdir).filter((n) => n.endsWith('.json')).map((n) => n.replace(/\.json$/, ''));
  const routes = new Set(['/', '/next-steps/', '/states/TN/', '/states/MS/', '/states/AR/']);
  for (const c of cities) { routes.add(`/${c.slug}/`); routes.add(`/${c.slug}/next-steps/`); }
  for (const g of globals) routes.add(g === 'home' ? '/' : `/${g.replace(/^guides_/, 'guides/')}/`);
  return [...routes].sort();
}

const SENIOR_TERMS = /(care|senior|assisted|memory|dementia|nursing|retirement|respite|elder|aging|old people)/i;

async function main() {
  const args = process.argv.slice(2);
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const routesAbs = path.join(ROOT, ROUTES_REL);
  if (opt('--routes-from')) {
    const routes = routesFrom(opt('--routes-from'));
    fs.mkdirSync(path.dirname(routesAbs), { recursive: true });
    fs.writeFileSync(routesAbs, JSON.stringify({ schema_version: '1.0', site: 'https://memphisseniorcarehomes.com', source: 'seq23/local-guides-generator data/page_sets/examples/cities_senior_living_v1.json + senior_living_global_pages/', refreshed_from: 'local checkout via --routes-from', route_count: routes.length, routes }, null, 2) + '\n');
  }
  if (!fs.existsSync(routesAbs)) throw new Error(`missing ${ROUTES_REL}; run with --routes-from <local-guides-generator checkout>`);
  const routeSet = new Set(JSON.parse(fs.readFileSync(routesAbs, 'utf8')).routes);

  const src = opt('--source') || process.env.SENIOR_FANOUT_SOURCE || LIVE;
  const canon = await readCanonicalFanout(src);
  const compiled = new Map();
  const add = (row) => { const key = normalizeQuery(row.query); if (!key || compiled.has(key)) return; compiled.set(key, { normalized_query: key, ...row }); };
  for (const row of grid()) add(row);
  let ingested = 0;
  let dropped = 0;
  for (const it of canon.items) {
    // Page titles ride along in the canonical fan-out as 'primary' items; they are
    // not searches, so they are not compiled as questions.
    if (!it.query || !SENIOR_TERMS.test(it.query) || it.query.includes(':') || it.query.length > 90) continue;
    if (!routeSet.has(it.href)) { dropped++; continue; }
    const parsed = parseQuery(it.query, it.href);
    const before = compiled.size;
    add({ query: it.query,
      question: question(parsed.head, parsed.mod, parsed.loc ? parsed.loc[1] : null),
      answer: answer(parsed.head, parsed.mod, parsed.loc),
      head_phrase: parsed.head, modifier: parsed.mod || null,
      locality: parsed.loc && !parsed.region ? parsed.loc[0] : null, region: parsed.loc && parsed.region ? parsed.loc[0] : null,
      state: parsed.loc ? parsed.loc[3] : null, canonical_route: it.href,
      canonical_label: labelFor(it.href, parsed.loc), velocity_piece: pieceFor(parsed.head, parsed.mod, parsed.loc), source: 'canonical_fanout' });
    if (compiled.size > before) ingested++;
  }
  // Canonical fan-out unreachable (site not live yet, a rebuild in progress): keep
  // the canonical rows the last successful read compiled, never shrink silently.
  let carried = 0;
  if (canon.status !== 'read' && fs.existsSync(path.join(ROOT, OUT_REL))) {
    for (const r of JSON.parse(fs.readFileSync(path.join(ROOT, OUT_REL), 'utf8')).queries || []) {
      if (r.source === 'canonical_fanout' && routeSet.has(r.canonical_route) && !compiled.has(r.normalized_query)) { compiled.set(r.normalized_query, r); carried++; }
    }
  }
  const rows = [...compiled.values()];
  // fail before write
  const off = rows.filter((r) => !routeSet.has(r.canonical_route));
  if (off.length) throw new Error(`${off.length} compiled queries route outside ${ROUTES_REL}, e.g. ${off[0].query} -> ${off[0].canonical_route}`);
  const missing = LOCALITIES.map((l) => l[0]).filter((l) => !rows.some((r) => r.locality === l));
  if (missing.length) throw new Error(`localities with zero compiled queries: ${missing.join(', ')}`);
  const pieces = Object.values(PIECE);
  const perPiece = Object.fromEntries(pieces.map((p) => [p, rows.filter((r) => r.velocity_piece === p).length]));
  const empty = pieces.filter((p) => !perPiece[p]);
  if (empty.length) throw new Error(`pieces with zero compiled queries: ${empty.join(', ')}`);
  const out = {
    schema_version: '1.0', vertical: 'senior-living', canonical_site: 'https://memphisseniorcarehomes.com',
    note: 'Query -> Velocity piece -> canonical route. No page is created per query; each piece renders its question set and links the route that owns the full answer.',
    sources: { velocity_grid: rows.filter((r) => r.source === 'velocity_grid').length, canonical_fanout: { source: /^https?:/.test(src) ? src : 'memphisseniorcarehomes.com dist/_fanout_query_clusters.json (local build)', status: canon.status, generated_at: canon.generated_at || null, items_read: canon.items.length, ingested, carried_forward: carried, dropped_route_not_in_list: dropped } },
    localities: LOCALITIES.map((l) => l[0]), regions: REGIONS.map((l) => l[0]),
    query_count: rows.length, per_piece: perPiece,
    queries: rows.sort((a, b) => a.velocity_piece.localeCompare(b.velocity_piece) || a.normalized_query.localeCompare(b.normalized_query))
  };
  fs.mkdirSync(path.dirname(path.join(ROOT, OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), JSON.stringify(out, null, 2) + '\n');
  console.log(`senior-living fan-out: ${rows.length} compiled queries (${ingested} from the canonical fan-out, status ${canon.status}); per piece ${JSON.stringify(Object.values(perPiece))}`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { PIECE, LOCALITIES, ROUTES_REL, OUT_REL };
