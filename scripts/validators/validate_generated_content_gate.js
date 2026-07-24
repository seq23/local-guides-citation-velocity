#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { ALLOWED_ATOM_TYPES, validateContentAtom } = require('../lib/content_atom');

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT = path.join(ROOT, 'artifacts', 'validation', 'generated-content-gate-details.json');
const STANDARD_PATH = path.join(ROOT, 'data', 'content', 'programmatic_content_standard.json');
const STAGED_PATH = path.join(ROOT, 'content', '_staged', 'pages.json');
const LIVE_PATH = path.join(ROOT, 'content', '_live', 'pages.json');
const INSIGHTS_PATH = path.join(ROOT, 'content', '_live', 'insights.json');
const REGISTRY_PATH = path.join(ROOT, 'content', '_shared', 'query_cluster_registry.json');

const STOPWORDS = new Set('a an and are as at be best by can do does for from how i in into is it me my near of on or should the this to vs what when where which who why with you your'.split(' '));

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function cleanText(value) { return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function wordCount(value) { return cleanText(value).split(/\s+/).filter(Boolean).length; }
function tokens(value) { return cleanText(value).toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((token) => token && !STOPWORDS.has(token)); }
function extract(html, regex) { const match = String(html || '').match(regex); return match ? cleanText(match[1]) : ''; }
function metaDescription(html) {
  const direct = String(html).match(/<meta[^>]+name=["']description["'][^>]+content=(["'])([\s\S]*?)\1/i);
  if (direct) return cleanText(direct[2]);
  const reverse = String(html).match(/<meta[^>]+content=(["'])([\s\S]*?)\1[^>]+name=["']description["']/i);
  return reverse ? cleanText(reverse[2]) : '';
}
function routeToFile(route) {
  const value = String(route || '/').trim();
  if (value === '/') return path.join(ROOT, 'index.html');
  if (value.endsWith('.html')) return path.join(ROOT, value.replace(/^\//, ''));
  const clean = value.replace(/^\//, '').replace(/\/$/, '');
  return path.join(ROOT, clean, 'index.html');
}
function collectTypes(value, out = new Set()) {
  if (Array.isArray(value)) { value.forEach((entry) => collectTypes(entry, out)); return out; }
  if (!value || typeof value !== 'object') return out;
  if (value['@type']) {
    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    types.forEach((type) => out.add(String(type)));
  }
  Object.values(value).forEach((entry) => collectTypes(entry, out));
  return out;
}
function schemaTypes(html) {
  const out = new Set();
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    try { collectTypes(JSON.parse(match[1]), out); } catch (error) { out.add(`INVALID_JSON_LD:${error.message}`); }
  }
  return out;
}
function siblingLinkCount(html) {
  const block = String(html).match(/<section[^>]+data-sibling-links=["']true["'][^>]*>([\s\S]*?)<\/section>/i);
  if (!block) return 0;
  const hrefs = [...block[1].matchAll(/<a[^>]+href=["'](\/[^"'#?]+)["']/gi)].map((match) => match[1]);
  return new Set(hrefs).size;
}
function contentAtomMarkers(html) {
  return [...String(html).matchAll(/data-content-atom=["']([^"']+)["'][^>]*data-atom-id=["']([^"']+)["'][^>]*data-atom-uniqueness=["']([^"']+)["'](?:[^>]*data-atom-semantic=["']([^"']+)["'])?/gi)]
    .map((match) => ({ type: match[1], atom_id: match[2], uniqueness_key: match[3], semantic_signature: match[4] || match[3] }));
}
function directAnswer(html) {
  const block = String(html).match(/<section[^>]+data-direct-answer=["']true["'][^>]*>([\s\S]*?)<\/section>/i);
  return block ? cleanText(block[1].replace(/<div[^>]*>.*?<\/div>/i, '')) : '';
}
function routeSet() {
  const live = readJson(LIVE_PATH);
  const insights = readJson(INSIGHTS_PATH);
  const registry = readJson(REGISTRY_PATH);
  const routes = new Map();
  for (const page of live.pages || []) {
    if (page.publication_status === 'EVIDENCE_ONLY') continue;
    const route = page.path && String(page.path).startsWith('/insights/') ? page.path : page.slug;
    if (!route) continue;
    routes.set(route, { route, kind: String(route).startsWith('/insights/') ? 'insight' : 'editorial', source: page });
  }
  for (const item of insights.items || []) routes.set(item.publish_path, { route: item.publish_path, kind: 'insight', source: item });
  for (const [vertical, meta] of Object.entries(registry || {})) {
    for (const [cluster, clusterMeta] of Object.entries(meta.clusters || {})) {
      const route = clusterMeta.path || `/${meta.base_path || vertical}/${cluster}/`;
      if (!routes.has(route)) routes.set(route, { route, kind: 'registry_cluster', source: clusterMeta });
    }
  }
  return [...routes.values()].sort((a, b) => a.route.localeCompare(b.route));
}

const errors = [];
const warnings = [];
const standard = readJson(STANDARD_PATH);
if (standard.ship_law !== 'A programmatic editorial page without one valid, page-specific, defensible data atom is not admitted to the public release inventory.') errors.push('standard_ship_law_changed');

const staged = readJson(STAGED_PATH);
const live = readJson(LIVE_PATH);
for (const [label, payload] of [['staged', staged], ['live', live]]) {
  if (payload.programmatic_content_gate?.status !== 'ENFORCED') errors.push(`${label}:programmatic_gate_not_enforced`);
  for (const page of payload.pages || []) {
    const pageTitle = page.title || page.slug || page.path;
    const pageIssues = validateContentAtom(page.content_atom, { title: pageTitle });
    if (pageIssues.length) errors.push(`${label}:${page.slug || page.path}:page_atom:${pageIssues.join(',')}`);
    for (const [index, section] of (page.sections || []).entries()) {
      const title = section.visible_q || section.q || section.title || `${pageTitle} section ${index + 1}`;
      const sectionIssues = validateContentAtom(section.content_atom, { title });
      if (sectionIssues.length) errors.push(`${label}:${page.slug || page.path}#${index + 1}:section_atom:${sectionIssues.join(',')}`);
    }
  }
}

const stagedByIdentity = new Map((staged.pages || []).map((page) => [`${page.slug || ''}|${page.path || ''}`, page]));
for (const page of live.pages || []) {
  const key = `${page.slug || ''}|${page.path || ''}`;
  const stagedPage = stagedByIdentity.get(key);
  if (!stagedPage) errors.push(`live_without_staged_source:${key}`);
  else if (stagedPage.content_atom?.uniqueness_key !== page.content_atom?.uniqueness_key) errors.push(`staged_live_page_atom_mismatch:${key}`);
}

const routes = routeSet();
const seenTitles = new Map();
const seenDescriptions = new Map();
const seenH1 = new Map();
const seenAtomIds = new Map();
const seenAtomUniqueness = new Map();
const seenAtomSemantic = new Map();
const rendered = [];
const requiredSchema = ['Article', 'BreadcrumbList'];

for (const entry of routes) {
  const file = routeToFile(entry.route);
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  const pageErrors = [];
  if (!fs.existsSync(file)) {
    errors.push(`${entry.route}:missing_rendered_file:${rel}`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  const title = extract(html, /<title>([\s\S]*?)<\/title>/i);
  const description = metaDescription(html);
  const h1 = extract(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const answer = directAnswer(html);
  const atomMarkers = contentAtomMarkers(html);
  const types = schemaTypes(html);
  const siblings = siblingLinkCount(html);

  if (!/^\s*<!doctype html>/i.test(html)) pageErrors.push('missing_doctype');
  if (title.length < 8) pageErrors.push('missing_or_short_title');
  if (description.length < 20) pageErrors.push('missing_or_short_meta_description');
  if (h1.length < 3) pageErrors.push('missing_or_short_h1');
  if (!/<link[^>]+rel=["']canonical["'][^>]+href=["']https?:\/\/[^"']+["']/i.test(html) && !/<link[^>]+href=["']https?:\/\/[^"']+["'][^>]+rel=["']canonical["']/i.test(html)) pageErrors.push('missing_absolute_canonical');
  const answerWords = wordCount(answer);
  if (answerWords < 5 || answerWords > 300) pageErrors.push(`direct_answer_unusable_length:${answerWords}`);
  else if (answerWords > 100) warnings.push(`${entry.route}:direct_answer_long:${answerWords}`);
  if (/typically comes down to cost, timeline|this page gives a short framing answer first|lorem ipsum|TODO|FIXME|\[object Object\]|undefined/i.test(answer)) pageErrors.push('generic_or_broken_direct_answer');
  const titleTokens = new Set(tokens(h1));
  const answerTokens = new Set(tokens(answer));
  if (titleTokens.size >= 2 && ![...titleTokens].some((token) => answerTokens.has(token))) pageErrors.push('direct_answer_not_page_specific');
  if (atomMarkers.length !== 1) pageErrors.push(`content_atom_marker_count:${atomMarkers.length}`);
  if (atomMarkers[0]) {
    if (!ALLOWED_ATOM_TYPES.includes(atomMarkers[0].type)) pageErrors.push(`unsupported_rendered_atom_type:${atomMarkers[0].type}`);
    if (!/^ATOM-[A-F0-9]{18}$/.test(atomMarkers[0].atom_id)) pageErrors.push('invalid_rendered_atom_id');
    if (!/^[a-f0-9]{24}$/i.test(atomMarkers[0].uniqueness_key)) pageErrors.push('invalid_rendered_atom_uniqueness');
  }
  for (const type of requiredSchema) if (!types.has(type)) pageErrors.push(`missing_schema:${type}`);
  if ([...types].some((type) => type.startsWith('INVALID_JSON_LD:'))) pageErrors.push('invalid_json_ld');
  if (siblings === 0) pageErrors.push('missing_sibling_links');
  else if (siblings < 3 || siblings > 20) warnings.push(`${entry.route}:sibling_link_count_advisory:${siblings}`);
  const renderedWords=wordCount(html);
  if (renderedWords < 80) pageErrors.push(`page_unusably_thin:${renderedWords}`);
  else if (renderedWords < 180) warnings.push(`${entry.route}:page_depth_advisory:${renderedWords}`);

  for (const [value, map, label] of [[title, seenTitles, 'title'], [description, seenDescriptions, 'meta_description'], [h1, seenH1, 'h1']]) {
    const normalized = value.toLowerCase();
    if (map.has(normalized)) {
      const issue = `duplicate_${label}_with:${map.get(normalized)}`;
      if (label === 'meta_description') warnings.push(`${entry.route}:${issue}`);
      else pageErrors.push(issue);
    } else map.set(normalized, entry.route);
  }
  if (atomMarkers[0]) {
    if (seenAtomIds.has(atomMarkers[0].atom_id)) pageErrors.push(`duplicate_atom_id_with:${seenAtomIds.get(atomMarkers[0].atom_id)}`);
    else seenAtomIds.set(atomMarkers[0].atom_id, entry.route);
    if (seenAtomUniqueness.has(atomMarkers[0].uniqueness_key)) pageErrors.push(`duplicate_route_atom_identity_with:${seenAtomUniqueness.get(atomMarkers[0].uniqueness_key)}`);
    else seenAtomUniqueness.set(atomMarkers[0].uniqueness_key, entry.route);
    if (seenAtomSemantic.has(atomMarkers[0].semantic_signature)) warnings.push(`${entry.route}:duplicate_content_atom_semantics_with:${seenAtomSemantic.get(atomMarkers[0].semantic_signature)}`);
    else seenAtomSemantic.set(atomMarkers[0].semantic_signature, entry.route);
  }

  if (pageErrors.length) errors.push(...pageErrors.map((issue) => `${entry.route}:${issue}`));
  rendered.push({ route: entry.route, kind: entry.kind, file: rel, title, description, h1, direct_answer_words: answerWords, sibling_links: siblings, atom: atomMarkers[0] || null, schema_types: [...types].sort(), issues: pageErrors });
}

const insightManifest = readJson(INSIGHTS_PATH);
for (const item of insightManifest.items || []) {
  if (!item.content_atom) errors.push(`${item.publish_path}:manifest_missing_content_atom`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date_modified || ''))) errors.push(`${item.publish_path}:manifest_missing_date_modified`);
}

fs.mkdirSync(path.dirname(REPORT), { recursive: true });
const report = {
  checked_at: new Date().toISOString(),
  standard: path.relative(ROOT, STANDARD_PATH).replace(/\\/g, '/'),
  scope: { routes_checked: routes.length, source_pages_staged: (staged.pages || []).length, source_pages_live: (live.pages || []).length, insights: (insightManifest.items || []).length },
  allowed_atom_types: ALLOWED_ATOM_TYPES,
  error_count: errors.length,
  warning_count: warnings.length,
  errors,
  warnings,
  rendered
};
fs.writeFileSync(REPORT, JSON.stringify(report, null, 2) + '\n', 'utf8');
const evidencePath = path.join(ROOT, 'artifacts', 'validation', 'generated-content-gate.json');
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, JSON.stringify({
  validator: 'generated-content-gate',
  ok: errors.length === 0,
  routes_checked: routes.length,
  insights_checked: (insightManifest.items || []).length,
  source_pages_staged: (staged.pages || []).length,
  source_pages_live: (live.pages || []).length,
  quarantined_duplicate_atoms: fs.existsSync(path.join(ROOT, 'content', '_live', 'insight_quarantine.json')) ? readJson(path.join(ROOT, 'content', '_live', 'insight_quarantine.json')).quarantined_count : 0,
  error_count: errors.length,
  warning_count: warnings.length,
  report: path.relative(ROOT, REPORT).replace(/\\/g, '/')
}, null, 2) + '\n', 'utf8');

if (errors.length) {
  console.error(`Programmatic content gate failed with ${errors.length} issue(s). See artifacts/validation/generated-content-gate-details.json`);
  console.error(errors.slice(0, 60).join('\n'));
  process.exit(1);
}
console.log(`Programmatic content gate passed: ${routes.length} existing editorial pages, ${(insightManifest.items || []).length} insights, and all staged/live source rows have one defensible atom.`);
