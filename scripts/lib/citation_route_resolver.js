'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function rel(p) { return path.join(ROOT, p); }
function normalizeImplementationPath(value) {
  let rawValue = value && typeof value === 'object' ? (value.value || value.path || value.url || value.target || '') : value;
  let out = String(rawValue || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\?.*$/, '').replace(/#.*$/, '');
  if (out && !out.endsWith('.html') && !out.endsWith('.json') && !out.endsWith('.csv')) out = out.replace(/\/+$/, '') + '/index.html';
  return out.replace(/\/+/g, '/');
}
function normalizeSlugComparable(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\.html$|\/index\.html$/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function editDistance(a, b) {
  a = String(a || ''); b = String(b || '');
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
  return dp[a.length][b.length];
}
function similarityScore(a, b) {
  a = normalizeSlugComparable(a); b = normalizeSlugComparable(b);
  if (!a || !b) return 0; if (a === b) return 1;
  const A = new Set(a.split('-').filter(Boolean)), B = new Set(b.split('-').filter(Boolean));
  const inter = [...A].filter(x => B.has(x)).length; const union = new Set([...A, ...B]).size || 1;
  const token = inter / union;
  const len = Math.max(a.length, b.length) || 1;
  const levenshtein = 1 - (editDistance(a, b) / len);
  let prefix = 0;
  for (let i=0;i<Math.min(a.length,b.length);i++) { if (a[i]===b[i]) prefix++; else break; }
  return Math.max(token, levenshtein, prefix / len);
}
function findExistingInsightsByNumber(numberedSlug) {
  const dir = rel('insights');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.html') && name.includes(numberedSlug))
    .map((name) => `insights/${name}`)
    .filter((candidate) => fs.existsSync(rel(candidate)))
    .sort();
}
function walkHtml(dir, prefix='', out=[]) {
  const abs = rel(dir);
  if (!fs.existsSync(abs)) return out;
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = path.join(dir, ent.name).replace(/\\/g, '/');
    if (ent.isDirectory()) walkHtml(r, prefix, out);
    else if (ent.isFile() && ent.name.endsWith('.html')) out.push(r);
  }
  return out;
}
function titleOf(file) { try { const text=fs.readFileSync(rel(file),'utf8'); return (text.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)||text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)||[])[1]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() || ''; } catch { return ''; } }
let ROUTE_REGISTRY_CACHE = null;
const BUILD_OUTPUT_PREFIX = /^(?:dist|\.pages-output|node_modules|artifacts|coverage)\//;
function buildRouteRegistry() {
  if (ROUTE_REGISTRY_CACHE) return ROUTE_REGISTRY_CACHE;
  const files = [...walkHtml('insights'), ...walkHtml('guides'), ...walkHtml('compare'), ...walkHtml('near-me'), ...walkHtml('')]
    // Build output is the same page again under another prefix. Leaving it in
    // the registry made every title match tie with itself (dist/insights/x.html
    // scoring 1.000 against insights/x.html), so a perfectly identifiable page
    // was reported BLOCKED_AMBIGUOUS_FUZZY_ROUTE.
    .filter((f, i, arr) => f && !BUILD_OUTPUT_PREFIX.test(f) && arr.indexOf(f) === i && fs.existsSync(rel(f)));
  ROUTE_REGISTRY_CACHE = files.map(file => {
    const title = titleOf(file);
    return { implementation_path: normalizeImplementationPath(file), comparable_path: normalizeSlugComparable(file), title, comparable_title: normalizeSlugComparable(title) };
  });
  return ROUTE_REGISTRY_CACHE;
}
function routeFamilyForPath(value) {
  const p = normalizeImplementationPath(value);
  if (!p) return 'UNKNOWN';
  if (p.startsWith('insights/')) return 'INSIGHT';
  if (p.includes('/community-questions/')) return 'COMMUNITY_QA';
  if (p.includes('/guides/')) return 'GUIDE';
  if (p.endsWith('/index.html')) return 'LIVE_PAGE';
  return 'STATIC_FILE';
}
// A numbered stem, and a distinctive section token, are identities rather than
// fuzzy guesses.
//
// The review agent refers to pages by stable stem or by topic:
// insights/trt-002.html for
// insights/trt-002-how-to-compare-trt-clinics-in-2026.html, and
// dentistry/pediatric-dentistry/ for dentistry/pediatric-family/. Similarity
// scoring never cleared the 0.78 threshold on either shape, so both were
// reported TARGET_NOT_FOUND and the same recommendations were re-issued run
// after run - 111 blocked entries against just seven real pages.
//
// Both rules resolve only when exactly one published page matches, so
// dentistry/dental-implants/ correctly stays unresolved: "dental" matches three
// siblings and there is no honest way to choose. Generic words are excluded so
// "cost" or "treatment" can never carry a match alone.
const GENERIC_ROUTE_TOKENS = new Set([
  'dentistry','dental','treatment','planning','guide','guides','near','best','top',
  'cost','costs','care','services','service','options','local','index','html'
]);
function resolveNumberedStem(raw) {
  const p = normalizeImplementationPath(raw);
  const m = p.match(/^(.*?)([a-z]+-\d{2,})(?:[-.].*)?\.html$/i);
  if (!m) return '';
  const [, dir, stem] = m;
  const matches = buildRouteRegistry().map(r => r.implementation_path)
    .filter(f => f.startsWith(`${dir}${stem}-`) && f.endsWith('.html'));
  return matches.length === 1 ? matches[0] : '';
}
function resolveDistinctiveSection(raw) {
  const p = normalizeImplementationPath(raw);
  const m = p.match(/^(.*?\/)([^/]+)\/index\.html$/i);
  if (!m) return '';
  const [, parent, requested] = m;
  const tokens = requested.toLowerCase().split(/[^a-z0-9]+/)
    .map(t => t.replace(/s$/, ''))
    .filter(t => t.length >= 5 && !GENERIC_ROUTE_TOKENS.has(t));
  if (!tokens.length) return '';
  // Direct children only. Matching any descendant pulled in
  // <section>/community-questions/<question>/index.html, so a topic token hit a
  // dozen unrelated Q&A pages and every candidate looked ambiguous.
  const siblings = [...new Set(buildRouteRegistry().map(r => r.implementation_path)
    .filter(f => f.startsWith(parent) && f.endsWith('/index.html'))
    .map(f => f.slice(parent.length).replace(/\/index\.html$/, ''))
    .filter(sec => sec && !sec.includes('/')))];
  const hits = siblings.filter(sib => {
    const sibTokens = sib.toLowerCase().split(/[^a-z0-9]+/).map(t => t.replace(/s$/, ''));
    return tokens.some(t => sibTokens.includes(t));
  });
  return hits.length === 1 ? `${parent}${hits[0]}/index.html` : '';
}

// The WORDS outrank the NUMBER.
//
// insights/ pages are named `<vertical>-<serial>-<descriptive-slug>.html`. A review
// agent citing one from memory reliably keeps the words and mis-remembers the serial:
// the 2026-08-05 TRT run reported
// insights/trt-003-trt-injections-vs-gel-how-to-decide.html, which does not exist. The
// page it means is insights/trt-022-trt-injections-vs-gel-how-to-decide.html - same
// descriptive slug to the character, different serial.
//
// resolveTargetPath used to reach the CANONICALIZED_BY_NUMBERED_INSIGHT branch first,
// match on `trt-003` alone, and hand back
// insights/trt-003-how-to-compare-local-options-using-a-real-decision-checklist.html -
// a page about an entirely different subject. The repair was then applied to the wrong
// page, the ledger recorded it as absorbed, and the URL the agent actually tested went
// on 404ing. It sat in the absorption ratchet as a known-bad fuzzy resolution.
//
// A serial is one token that two unrelated pages can share. A descriptive slug of
// several words is an identity. So the descriptive slug is tried first, and only when
// it names exactly ONE published page - an ambiguous slug still falls through to the
// scoring below rather than guessing.
function resolveDescriptiveNumberedSlug(raw) {
  const p = normalizeImplementationPath(raw);
  const m = p.match(/^(.*\/)?([a-z]+(?:-[a-z]+)*)-(\d{2,})-([a-z0-9-]{6,})\.html$/i);
  if (!m) return '';
  const [, dirRaw, family, serial, descriptive] = m;
  const dir = dirRaw || '';
  const wanted = normalizeSlugComparable(descriptive);
  if (!wanted || wanted.split('-').filter(Boolean).length < 3) return '';
  const matches = buildRouteRegistry().map((r) => r.implementation_path)
    .filter((f) => f.startsWith(dir) && f.endsWith('.html') && !f.slice(dir.length).includes('/'))
    .filter((f) => {
      const name = f.slice(dir.length).replace(/\.html$/, '');
      const parts = name.match(/^([a-z]+(?:-[a-z]+)*)-(\d{2,})-(.+)$/i);
      if (!parts) return false;
      // Same page family, so trt-022 can answer for trt-003 but neuro-022 cannot.
      return parts[1].toLowerCase() === family.toLowerCase() && normalizeSlugComparable(parts[3]) === wanted;
    });
  if (matches.length !== 1) return '';
  // An exact hit on the requested path is handled by the caller before this runs; if
  // the one match IS the requested path there is nothing to canonicalize.
  return matches[0] === p ? '' : matches[0];
}

// The agent does not always hand back a path. Two shapes arrive often enough to
// be worth canonicalizing rather than reporting TARGET_NOT_FOUND:
//
//   "Best%20TRT%20Clinic%20Near%20Me/index.html"   a page title, percent-encoded
//   "FILEPATH: trt/index.html || CURRENT: ..."     the whole recommendation line
//
// Percent-encoding is the more damaging of the two. normalizeSlugComparable
// turns %20 into the literal "20", so "best trt clinic near me" compared as
// "best-20trt-20clinic-20near-20me" and could not score against any real title
// - which is why every one of these was reported as an unresolvable target on
// run after run. Decoding restores the title, and the existing title similarity
// scoring (with its tie check) then does the matching, so an ambiguous title
// still blocks rather than guessing.
function canonicalizeRawTarget(raw) {
  let text = String(raw || '').trim();
  const filepath = text.match(/FILEPATH:\s*([^|]+?)\s*(?:\|\||$)/i);
  if (filepath) text = filepath[1].trim();
  if (/%[0-9a-f]{2}/i.test(text)) {
    try { text = decodeURIComponent(text); } catch { /* leave as-is if malformed */ }
  }
  return text;
}

function resolveFuzzyRoute(raw, options = {}) {
  raw = canonicalizeRawTarget(raw);
  const descriptiveMatch = resolveDescriptiveNumberedSlug(raw);
  if (descriptiveMatch) return { implementation_path: descriptiveMatch, status: 'DESCRIPTIVE_SLUG_RESOLVED', block_reason: '', route_family: routeFamilyForPath(descriptiveMatch), canonicalized_from: [normalizeImplementationPath(raw)] };
  const stemMatch = resolveNumberedStem(raw);
  if (stemMatch) return { implementation_path: stemMatch, status: 'STEM_ROUTE_RESOLVED', block_reason: '', route_family: routeFamilyForPath(stemMatch), canonicalized_from: raw };
  const sectionMatch = resolveDistinctiveSection(raw);
  if (sectionMatch) return { implementation_path: sectionMatch, status: 'SECTION_ROUTE_RESOLVED', block_reason: '', route_family: routeFamilyForPath(sectionMatch), canonicalized_from: raw };
  const registry = buildRouteRegistry();
  const hay = [raw, options.query, options.title].filter(Boolean).join(' ');
  const target = normalizeSlugComparable(hay || raw);
  const scored = registry.map(r => ({ ...r, score: Math.max(similarityScore(target, r.comparable_path), similarityScore(target, r.comparable_title)) }))
    .filter(r => r.score >= Number(options.threshold || 0.78)).sort((a,b)=>b.score-a.score || a.implementation_path.localeCompare(b.implementation_path));
  if (!scored.length) return { implementation_path: '', status: 'TARGET_NOT_FOUND', block_reason: 'TARGET_NOT_FOUND', route_family: 'UNKNOWN', canonicalized_from: [normalizeImplementationPath(raw)], candidates: [] };
  const top = scored[0]; const ties = scored.filter(r => top.score - r.score < 0.04);
  if (ties.length > 1) return { implementation_path: '', status: 'BLOCKED_AMBIGUOUS_FUZZY_ROUTE', block_reason: 'BLOCKED_AMBIGUOUS_FUZZY_ROUTE', route_family: 'UNKNOWN', canonicalized_from: [normalizeImplementationPath(raw)], candidates: ties.slice(0,5).map(x=>({ implementation_path:x.implementation_path, score:x.score })) };
  return { implementation_path: top.implementation_path, status: 'FUZZY_ROUTE_RESOLVED', block_reason: '', route_family: routeFamilyForPath(top.implementation_path), canonicalized_from: [normalizeImplementationPath(raw)], candidates: scored.slice(0,5).map(x=>({ implementation_path:x.implementation_path, score:x.score })) };
}
function resolveTargetPath(value) {
  const input = value && typeof value === 'object' ? value : { value };
  const raw = normalizeImplementationPath(canonicalizeRawTarget(input.value || input.path || input.url || input.target || value));
  const op = input.operation || '';
  if (!raw) return { implementation_path: '', status: 'TARGET_NOT_FOUND', block_reason: 'TARGET_NOT_FOUND', route_family: 'UNKNOWN', canonicalized_from: [] };
  if (op === 'CREATE_NEW_TARGET_PAGE') {
    if (fs.existsSync(rel(raw))) return { implementation_path: raw, status: 'EXACT_NEW_PAGE_DUPLICATE_EXISTS', block_reason: '', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
    return { implementation_path: raw, status: 'NEW_PAGE_TARGET_PRESERVED', block_reason: '', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
  }
  if (fs.existsSync(rel(raw))) return { implementation_path: raw, status: 'EXACT_EXISTS', block_reason: '', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
  const normalized = normalizeSlugComparable(raw);
  const exactComparable = buildRouteRegistry().filter(r => r.comparable_path === normalized || r.comparable_title === normalized);
  if (exactComparable.length === 1) return { implementation_path: exactComparable[0].implementation_path, status: 'SLUG_NORMALIZED_EXISTS', block_reason: '', route_family: routeFamilyForPath(exactComparable[0].implementation_path), canonicalized_from: [raw] };
  if (exactComparable.length > 1) return { implementation_path: '', status: 'BLOCKED_AMBIGUOUS_FUZZY_ROUTE', block_reason: 'BLOCKED_AMBIGUOUS_FUZZY_ROUTE', route_family: 'UNKNOWN', canonicalized_from: [raw], candidates: exactComparable.map(x=>x.implementation_path) };
  // Descriptive slug before serial: see resolveDescriptiveNumberedSlug.
  const descriptive = resolveDescriptiveNumberedSlug(raw);
  if (descriptive) return { implementation_path: descriptive, status: 'DESCRIPTIVE_SLUG_RESOLVED', block_reason: '', route_family: routeFamilyForPath(descriptive), canonicalized_from: [raw], candidates: [descriptive] };
  const match = raw.match(/(^|\/)([a-z-]+-\d{3})-/);
  if (match) {
    const candidates = findExistingInsightsByNumber(match[2]);
    if (candidates.length === 1) return { implementation_path: candidates[0], status: 'CANONICALIZED_BY_NUMBERED_INSIGHT', block_reason: '', route_family: routeFamilyForPath(candidates[0]), canonicalized_from: [raw], candidates };
    if (candidates.length > 1) return { implementation_path: '', status: 'AMBIGUOUS_TARGET_RESOLUTION', block_reason: 'AMBIGUOUS_TARGET_RESOLUTION', route_family: 'UNKNOWN', canonicalized_from: [raw], candidates };
  }
  const fuzzy = resolveFuzzyRoute(raw, { query: input.query, title: input.title, threshold: input.threshold });
  if (!fuzzy.block_reason) return fuzzy;
  return { implementation_path: raw, status: 'TARGET_NOT_FOUND', block_reason: 'TARGET_NOT_FOUND', route_family: routeFamilyForPath(raw), canonicalized_from: [] };
}
function routeFromPath(p) { return p ? `/${normalizeImplementationPath(p)}` : ''; }
module.exports = { resolveDescriptiveNumberedSlug, canonicalizeRawTarget, normalizeImplementationPath, normalizeSlugComparable, similarityScore, buildRouteRegistry, resolveFuzzyRoute, routeFamilyForPath, resolveTargetPath, routeFromPath };
