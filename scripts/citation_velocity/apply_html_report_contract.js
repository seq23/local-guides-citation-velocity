#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { deriveContentAtom } = require('../lib/content_atom');
const { routePage, routeForFamily } = require('../lib/page_family_router');
const { routeShape, renderedPathForRoute } = require('../lib/page_family_authority');

const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const AGENT_ROOT = 'data/report_fixes/agent_runs';
const REPORT_DATA = 'data/report_fixes/html_report_contract.generated.json';
const REPORT_ARTIFACT = 'artifacts/validation/html-report-contract.json';
const APPROVAL_QUEUE = 'data/community/approval_queue.json';
const SUPPORTED_VERTICALS = new Set(['personal_injury', 'dentistry', 'trt', 'neuro', 'uscis-medical']);

const verticalMap = {
  pi: 'personal_injury',
  'personal injury': 'personal_injury',
  personal_injury: 'personal_injury',
  'personal-injury': 'personal_injury',
  dentistry: 'dentistry',
  dental: 'dentistry',
  trt: 'trt',
  testosterone: 'trt',
  neuro: 'neuro',
  neuropsych: 'neuro',
  uscis: 'uscis-medical',
  'uscis medical': 'uscis-medical',
  'uscis-medical': 'uscis-medical'
};

function rel(...parts) { return path.join(ROOT, ...parts); }
function exists(p) { return fs.existsSync(rel(p)); }
function readText(p) { return fs.readFileSync(rel(p), 'utf8'); }
function writeText(p, value) { const out = rel(p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, value, 'utf8'); }
function readJson(p, fallback) { try { return JSON.parse(readText(p)); } catch { return fallback; } }
function writeJson(p, value) { writeText(p, JSON.stringify(value, null, 2) + '\n'); }
function sha(value, len = 12) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, len); }
function normalizeVertical(value) { const key = String(value || '').trim().toLowerCase().replace(/_/g, '-'); return verticalMap[key] || verticalMap[key.replace(/-/g, ' ')] || key; }
function slugify(value) { return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'citation-question'; }
function routeFor(vertical, question) { return routeForFamily(vertical, question, 'CREATE_COMMUNITY_QA'); }
function normalizeSpace(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function titleNorm(value) { return normalizeSpace(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function compact(value, max = 340) { const v = normalizeSpace(value); return v.length <= max ? v : v.slice(0, max - 1).replace(/\s+\S*$/, '') + '…'; }
function unique(values) { return [...new Set((values || []).map(v => normalizeSpace(v)).filter(Boolean))]; }

function decodeEntities(value) {
  return String(value || '')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<t[dh]\b[^>]*>/gi, ' | ')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+([•])\s+/g, '\n$1 ')
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, ' ').replace(/\s+\|\s+/g, ' | ').trim())
    .filter(Boolean)
    .join('\n');
}

function extractSection(html, heading) {
  const re = new RegExp(`<h([23])\\b[^>]*>\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<\\/h\\1>`, 'i');
  const m = re.exec(html);
  if (!m) return '';
  const rest = html.slice(m.index + m[0].length);
  const next = rest.search(/<h[23]\b[^>]*>/i);
  return next >= 0 ? rest.slice(0, next) : rest;
}

function lineAfterToken(line, tokenRe) {
  const m = line.match(tokenRe);
  if (!m) return '';
  return normalizeSpace(line.slice(m.index + m[0].length).replace(/^[:|\-\s]+/, ''));
}
function firstUrl(value) { const m = String(value || '').match(/https?:\/\/[^\s)]+/); return m ? m[0].replace(/[.,;]+$/, '') : ''; }
function firstQuoted(value) { const m = String(value || '').match(/["“]([^"”]{5,})["”]/); return m ? normalizeSpace(m[1]) : ''; }
function cleanQuery(value) { return normalizeSpace(String(value || '').replace(/^\[NEW\]\s*/i, '').replace(/^[-•]\s*/, '').replace(/^Query:\s*/i, '').replace(/^\|?\s*Query:\s*\|?/i, '').replace(/^[:|\-\s]+/, '').replace(/^["“]|["”]$/g, '')); }

function parseFixLines(text, context) {
  const lines = text.split(/\r?\n/).map(l => normalizeSpace(l)).filter(Boolean);
  const fixes = [];
  let current = null;
  function flush() {
    if (!current) return;
    current.fix_recommendation = compact(current.fix_recommendation || current.raw_text || 'Strengthen this page for direct citation extraction.', 650);
    current.fix_type = current.fix_type || 'citation_readiness';
    current.id = `html_fix_${sha(`${current.report_html_path}:${current.page_url}:${current.query}:${current.fix_recommendation}`, 16)}`;
    fixes.push(current);
    current = null;
  }
  for (const line of lines) {
    if (/none this run/i.test(line)) continue;
    const url = firstUrl(line);
    const hasFixCue = /\b(Fix|Fix Recommendation|Recommended)\b/i.test(line);
    if (url && (/\bPage:\b/i.test(line) || hasFixCue || /^[-•]\s*https?:\/\//.test(line))) {
      flush();
      const query = firstQuoted(lineAfterToken(line, /\bQuery\s*:\s*\|?/i)) || firstQuoted(line);
      let fixType = '';
      const typeMatch = line.match(/Fix(?: Recommendation)?\s*(?:\[([^\]]+)\]|\(([^)]+)\))/i);
      if (typeMatch) fixType = normalizeSpace(typeMatch[1] || typeMatch[2]).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      let rec = lineAfterToken(line, /Fix Recommendation\s*(?:\[[^\]]+\])?\s*:\s*\|?/i) || lineAfterToken(line, /Fix\s*(?:\([^)]*\)|\[[^\]]+\])?\s*:\s*\|?/i);
      if (!rec && /^[-•]\s*https?:\/\//.test(line)) rec = normalizeSpace(line.split(url).slice(1).join(url).replace(/^\s*[:\-–—)]\s*/, ''));
      current = { ...context, page_url: url, query, fix_type: fixType, fix_recommendation: rec, raw_text: line, status: 'PLANNED' };
      continue;
    }
    if (current && /^Fix\b/i.test(line)) {
      const typeMatch = line.match(/Fix\s*(?:\(([^)]+)\)|\[([^\]]+)\])/i);
      if (typeMatch && !current.fix_type) current.fix_type = normalizeSpace(typeMatch[1] || typeMatch[2]).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      const rec = lineAfterToken(line, /Fix\s*(?:\([^)]*\)|\[[^\]]+\])?\s*:/i);
      current.fix_recommendation = compact([current.fix_recommendation, rec].filter(Boolean).join(' '), 650);
      continue;
    }
    if (current && !/^[-•]\s*(Query|Discovery Source|Recommended Cluster|Cluster|Why)/i.test(line) && line.length > 20) {
      current.fix_recommendation = compact([current.fix_recommendation, line].filter(Boolean).join(' '), 650);
    }
  }
  flush();
  return fixes;
}

function parsePagesToBuild(text, context) {
  const lines = text.split(/\r?\n/).map(l => normalizeSpace(l)).filter(Boolean);
  const pages = [];
  let current = null;
  function flush() {
    if (!current) return;
    current.query = cleanQuery(current.query);
    if (current.query && current.query.length >= 8) {
      current.cluster = current.cluster || 'guide';
      const routeDecision = routePage({ ...current, operation: 'CREATE_NEW_TARGET_PAGE', recommendation: current.why_worth_building || '' });
      current.route_family = routeDecision.family;
      current.route_reason = routeDecision.reason;
      current.route_shape = routeDecision.route_shape || routeShape(routeDecision.target_route);
      current.route_authority = routeDecision.route_authority || 'artifact_admitted';
      current.admission_basis = 'HTML_REPORT_CONTRACT_PAGE_TO_BUILD';
      current.blocked_reason = routeDecision.blocked_reason || '';
      current.target_route = routeDecision.target_route || routeFor(current.vertical, current.query);
      current.renderedPath = routeDecision.renderedPath || renderedPathForRoute(current.target_route);
      current.status = routeDecision.status || 'APPROVED';
      current.id = `html_page_${sha(`${current.report_html_path}:${current.vertical}:${current.query}`, 16)}`;
      pages.push(current);
    }
    current = null;
  }
  for (const line of lines) {
    const queryMatch = line.match(/(?:^|[-•|\s])(?:\[NEW\]\s*)?Query\s*:\s*\|?\s*["“]?([^"”|]+)["”]?/i) || line.match(/^\[NEW\]\s*[-–]?\s*Query\s*:\s*["“]?([^"”]+)["”]?/i);
    if (queryMatch) {
      flush();
      current = { ...context, query: cleanQuery(queryMatch[1]), discovery_source: '', cluster: '', why_worth_building: '', raw_lines: [line] };
      const src = line.match(/Discovery Source\s*:\s*\|?\s*([^|]+)/i);
      const cluster = line.match(/(?:Recommended\s+)?Cluster\s*:\s*\|?\s*([^|]+)/i);
      const why = line.match(/Why(?:\s+Worth\s+Building|\s+worth\s+building)?\s*:\s*\|?\s*(.+)$/i);
      if (src) current.discovery_source = normalizeSpace(src[1]);
      if (cluster) current.cluster = slugify(cluster[1]);
      if (why) current.why_worth_building = compact(why[1], 500);
      continue;
    }
    if (!current) continue;
    current.raw_lines.push(line);
    const source = line.match(/^(?:[-•]\s*)?Discovery Source\s*:\s*(.+)$/i) || line.match(/^(?:[-•]\s*)?Source\s*:\s*(.+)$/i);
    const cluster = line.match(/^(?:[-•]\s*)?(?:Recommended\s+)?Cluster\s*:\s*(.+)$/i);
    const why = line.match(/^(?:[-•]\s*)?Why(?:\s+Worth\s+Building|\s+worth\s+building|)\s*:\s*(.+)$/i) || line.match(/^(?:[-•]\s*)?Why\s*:\s*(.+)$/i);
    if (source) current.discovery_source = normalizeSpace(source[1]);
    else if (cluster) current.cluster = slugify(cluster[1]);
    else if (why) current.why_worth_building = compact([current.why_worth_building, why[1]].filter(Boolean).join(' '), 700);
    else if (line.length > 20 && !/Pending Your Action|Data|New Fixes/i.test(line)) current.why_worth_building = compact([current.why_worth_building, line].filter(Boolean).join(' '), 700);
  }
  flush();
  return pages;
}


function normalizePageUrl(value) {
  const raw = normalizeSpace(value);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `https://theindustryguides.com${raw}`;
  if (/^[a-z0-9][a-z0-9/_-]+(?:\.html)?$/i.test(raw)) return `https://theindustryguides.com/${raw}`;
  return raw;
}

function jsonFixRecords(payload, context) {
  const out = [];
  const categories = [
    ['free_wins', 'json_free_win'],
    ['outperform', 'json_outperform'],
    ['page_fixes', 'json_page_fix']
  ];
  for (const [key, fixType] of categories) {
    for (const item of Array.isArray(payload[key]) ? payload[key] : []) {
      const pageUrl = normalizePageUrl(item.file_path || item.page_url || item.url || item.target_page || '');
      const query = cleanQuery(item.query || item.Query || '');
      const recommendation = item.fix || item.fix_recommendation || item['Fix Recommendation'] || item.edit_instruction || '';
      if (!pageUrl || !query || !recommendation) continue;
      const row = {
        ...context,
        page_url: pageUrl,
        query,
        fix_type: fixType,
        fix_recommendation: compact(recommendation, 900),
        gap: compact(item.gap || '', 900),
        model: item.model || '',
        level: item.level || '',
        source_category: key,
        raw_text: `${query} ${pageUrl} ${recommendation}`,
        status: 'PLANNED'
      };
      row.id = `html_fix_${sha(`${row.report_json_path || row.report_html_path}:${row.page_url}:${row.query}:${row.fix_recommendation}`, 16)}`;
      out.push(row);
    }
  }
  return out;
}

function jsonPagesToBuild(payload, context) {
  const out = [];
  for (const item of Array.isArray(payload.pages_to_build) ? payload.pages_to_build : []) {
    const query = cleanQuery(item.query || item.Query || '');
    if (!query || query.length < 8) continue;
    const row = {
      ...context,
      query,
      discovery_source: item.discovery_source || item.source || 'json_agent_artifact',
      cluster: slugify(item.recommended_cluster || item.cluster || 'guide'),
      why_worth_building: compact(item.why_worth_building || item.why || item.reason || '', 700),
      raw_lines: [JSON.stringify(item)],
      target_route: '',
      route_family: '',
      blocked_reason: '',
      status: 'APPROVED'
    };
    const routeDecision = routePage({ ...row, operation: 'CREATE_NEW_TARGET_PAGE', recommendation: row.why_worth_building || '' });
    row.target_route = routeDecision.target_route || routeFor(context.vertical, query);
    row.route_family = routeDecision.family;
    row.route_reason = routeDecision.reason;
    row.route_shape = routeDecision.route_shape || routeShape(row.target_route);
    row.route_authority = routeDecision.route_authority || 'artifact_admitted';
    row.admission_basis = 'HTML_REPORT_CONTRACT_PAGE_TO_BUILD';
    row.renderedPath = routeDecision.renderedPath || renderedPathForRoute(row.target_route);
    row.blocked_reason = routeDecision.blocked_reason || '';
    row.status = routeDecision.status || 'APPROVED';
    row.id = `html_page_${sha(`${row.report_json_path || row.report_html_path}:${row.vertical}:${row.query}`, 16)}`;
    out.push(row);
  }
  return out;
}

function walkManifests(dirRel = AGENT_ROOT) {
  const start = rel(dirRel);
  const out = [];
  if (!fs.existsSync(start)) return out;
  function walk(abs) {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name === 'agent_run_manifest.json') out.push(path.relative(ROOT, p).replace(/\\/g, '/'));
    }
  }
  walk(start);
  return out.sort();
}

function repoPathFromUrl(url) {
  if (!url) return { kind: 'missing', path: '', host: '' };
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'theindustryguides.com') return { kind: 'external', path: '', host: parsed.hostname, pathname: parsed.pathname };
    let p = parsed.pathname.replace(/^\//, '');
    if (!p) p = 'index.html';
    if (/\.html\/?$/i.test(p)) p = p.replace(/\/+$/, '');
    else if (p.endsWith('/')) p += 'index.html';
    return { kind: 'local', path: p, host: parsed.hostname, pathname: parsed.pathname };
  } catch {
    return { kind: 'bad_url', path: '', host: '', pathname: '' };
  }
}
function routeFromPath(pathname) { return '/' + String(pathname || '').replace(/^\//, '').replace(/index\.html$/, '').replace(/\/?$/, '/'); }
function sourceRecordsFor(vertical) {
  return { personal_injury: ['SRC-CONGRESS-STATE-LEGISLATURES', 'SRC-CORNELL-SOL'], dentistry: ['SRC-ADA-MOUTHHEALTHY'], trt: ['SRC-FDA-TESTOSTERONE'], neuro: ['SRC-NIMH-ADHD'], 'uscis-medical': ['SRC-USCIS-I693'] }[vertical] || [];
}
function targetFor(vertical) {
  return { personal_injury: 'https://theaccidentguides.com/request-assistance/', dentistry: 'https://dentistryguides.com/request-assistance/', trt: 'https://hormonesivhair.com/request-assistance/', neuro: 'https://neuroevalguides.com/request-assistance/', 'uscis-medical': 'https://uscisexam.com/request-assistance/' }[vertical] || 'https://theindustryguides.com/';
}
function artifactForFix(fix) {
  return {
    id: `html-report-${fix.id}`,
    marker: `html-report-${fix.id}`,
    type: 'checklist',
    title: `Citation report fix: ${fix.query || fix.fix_type || 'page clarity'}`,
    intro: compact(fix.fix_recommendation, 240),
    items: unique([
      fix.query ? `Directly answer: ${fix.query}` : '',
      fix.fix_recommendation,
      'Make the source boundary and next step easy for answer engines to extract',
      'Keep provider-specific claims separate from general decision guidance'
    ]).slice(0, 6)
  };
}
function applyArtifact(item, fix) {
  const marker = `html-report-${fix.id}`;
  const existing = Array.isArray(item.citation_velocity_artifacts) ? item.citation_velocity_artifacts.filter(a => a && a.marker !== marker && a.id !== marker) : [];
  item.citation_velocity_artifacts = [artifactForFix(fix), ...existing].slice(0, 10);
  item.date_modified = DATE;
  item.description = compact(`${item.description || item.title} Citation report update: ${fix.fix_recommendation}`, 320);
    // Report page fixes are rendered through citation_velocity_artifacts. Do not insert
  // synthetic sections here: build_site derives stable insight slugs from section order.
  item.content_atom = deriveContentAtom({
    title: item.title,
    definition: item.answer || item.description,
    checklist: item.checklist || (item.sections || []).flatMap(s => s.checklist || []).slice(0, 8),
    red_flags: item.red_flags || (item.sections || []).flatMap(s => s.red_flags || []).slice(0, 8),
    citation_velocity_artifacts: item.citation_velocity_artifacts
  }, { sourceRoute: item.publish_path || item.slug || item.path || '/', title: item.title });
}
function patchJsonFile(jsonPath, mutate) {
  const before = fs.existsSync(rel(jsonPath)) ? readText(jsonPath) : '';
  const data = readJson(jsonPath, null);
  if (!data) return false;
  const changed = mutate(data) === true;
  if (changed) writeJson(jsonPath, data);
  const after = fs.existsSync(rel(jsonPath)) ? readText(jsonPath) : '';
  return before !== after;
}
function applyFixes(fixes) {
  const results = [];
  let applied = 0;
  const insights = readJson('content/_live/insights.json', { items: [] });
  const livePages = readJson('content/_live/pages.json', { pages: [] });
  const stagedPages = readJson('content/_staged/pages.json', { pages: [] });
  const insightBySlug = new Map((insights.items || []).map((item) => [item.slug, item]));
  const liveByRoute = new Map((livePages.pages || []).flatMap((item) => [[item.slug, item], [item.path, item]].filter(([k]) => k)));
  const stagedByRoute = new Map((stagedPages.pages || []).flatMap((item) => [[item.slug, item], [item.path, item]].filter(([k]) => k)));
  let insightsChanged = false;
  let liveChanged = false;
  let stagedChanged = false;

  for (const fix of fixes) {
    const resolved = repoPathFromUrl(fix.page_url);
    const result = { ...fix, resolved };
    if (resolved.kind === 'external') {
      result.status = 'EXTERNAL_TARGET_RECORDED';
      result.reason = 'Provider-domain target cannot be edited inside the Velocity repo; the fix is preserved as report evidence.';
      results.push(result);
      continue;
    }
    if (resolved.kind !== 'local') {
      result.status = 'BLOCKED_BAD_URL';
      results.push(result);
      continue;
    }
    let changed = false;
    if (resolved.path.startsWith('insights/') && resolved.path.endsWith('.html')) {
      const slug = path.basename(resolved.path, '.html');
      const item = insightBySlug.get(slug);
      if (item) {
        applyArtifact(item, fix);
        changed = true;
        insightsChanged = true;
      }
      result.source_file = 'content/_live/insights.json';
    } else {
      const route = routeFromPath(resolved.pathname);
      const liveItem = liveByRoute.get(route);
      const stagedItem = stagedByRoute.get(route);
      if (liveItem) { applyArtifact(liveItem, fix); changed = true; liveChanged = true; }
      if (stagedItem) { applyArtifact(stagedItem, fix); changed = true; stagedChanged = true; }
      result.source_file = 'content/_staged/pages.json + content/_live/pages.json';
    }
    result.status = changed ? 'APPLIED' : 'BLOCKED_MISSING_SOURCE_ITEM';
    if (changed) applied += 1;
    results.push(result);
  }
  if (insightsChanged) writeJson('content/_live/insights.json', insights);
  if (liveChanged) writeJson('content/_live/pages.json', livePages);
  if (stagedChanged) writeJson('content/_staged/pages.json', stagedPages);
  return { results, applied };
}
function approvalFromPageSpec(spec) {
  const vertical = normalizeVertical(spec.vertical);
  const query = cleanQuery(spec.query);
  return {
    id: spec.id,
    status: 'APPROVED',
    source: 'html_report_contract',
    source_run_id: `${spec.run_date}_${vertical}_html_report`,
    source_artifacts: { manifest: spec.manifest_path, html: spec.report_html_path, json: spec.report_json_path || '' },
    vertical,
    query,
    normalized_query: query,
    llm_bait_phrase: query,
    intended_winner_page: '',
    intended_winner_path: '',
    operation: 'CREATE_NEW_TARGET_PAGE',
    fix_type: 'html_report_page_gap',
    action_tier: 'html_report_pages_to_build',
    priority_score: 90,
    source_signal_ids: [`${spec.id}_html_report`],
    source_records: sourceRecordsFor(vertical),
    citation_velocity: true,
    recommended_action: spec.why_worth_building || `Build a citation-ready answer page for ${query}.`,
    status_reason: 'selected_from_html_report_pages_to_build',
    target_route: spec.target_route || routeFor(vertical, query),
    renderedPath: spec.renderedPath || renderedPathForRoute(spec.target_route || routeFor(vertical, query)),
    route_family: spec.route_family || 'CREATE_COMMUNITY_QA',
    route_reason: spec.route_reason || '',
    route_shape: spec.route_shape || routeShape(spec.target_route || routeFor(vertical, query)),
    route_authority: spec.route_authority || 'artifact_admitted',
    admission_basis: spec.admission_basis || 'HTML_REPORT_CONTRACT_PAGE_TO_BUILD',
    canonical_target_url: targetFor(vertical)
  };
}
function existingTitleIndex() {
  const titles = new Map();
  for (const file of ['content/_live/insights.json', 'content/_live/pages.json']) {
    const payload = readJson(file, {});
    for (const item of [...(payload.items || []), ...(payload.pages || [])]) {
      const key = titleNorm(item.title || item.visible_q || '');
      if (key) titles.set(key, item.slug || item.path || file);
    }
  }
  return titles;
}
function updateApprovalQueue(pageSpecs) {
  const current = readJson(APPROVAL_QUEUE, []);
  const kept = (Array.isArray(current) ? current : []).filter(row => row && row.source !== 'html_report_contract');
  const seen = new Set(kept.map(row => row.target_route || row.id));
  const existingTitles = existingTitleIndex();
  const added = [];
  const skipped = [];
  for (const spec of pageSpecs) {
    const approval = approvalFromPageSpec(spec);
    const titleKey = titleNorm(approval.query);
    if (String(approval.status || '').startsWith('BLOCKED_') || approval.blocked_reason) { skipped.push({ ...approval, skipped_reason: approval.blocked_reason || approval.status }); continue; }
    if (existingTitles.has(titleKey)) {
      skipped.push({ ...approval, skipped_reason: 'exact_title_already_exists', existing_route: existingTitles.get(titleKey) });
      continue;
    }
    const key = approval.target_route;
    if (seen.has(key)) { skipped.push({ ...approval, skipped_reason: 'approval_route_already_present' }); continue; }
    kept.push(approval);
    added.push(approval);
    seen.add(key);
  }
  writeJson(APPROVAL_QUEUE, kept);
  return { added_count: added.length, skipped_count: skipped.length, total_count: kept.length, added, skipped };
}
function parseReports() {
  const manifests = walkManifests();
  const parsed = [];
  const errors = [];
  const allFixes = [];
  const allPages = [];
  for (const manifestPath of manifests) {
    let manifest;
    try { manifest = readJson(manifestPath, null); } catch (err) { errors.push(`${manifestPath}:invalid_json:${err.message}`); continue; }
    if (!manifest || !manifest.html_path) { errors.push(`${manifestPath}:missing_html_path`); continue; }
    if (!exists(manifest.html_path)) { errors.push(`${manifestPath}:html_file_missing:${manifest.html_path}`); continue; }
    const vertical = normalizeVertical(manifest.vertical);
    const context = { manifest_path: manifestPath, report_html_path: manifest.html_path, report_json_path: manifest.json_path || '', run_date: manifest.run_date, vertical };
    let fixes = [];
    let pages = [];
    let parser = 'html';
    if (manifest.json_path && exists(manifest.json_path)) {
      const payload = readJson(manifest.json_path, null);
      if (!payload) { errors.push(`${manifestPath}:invalid_json_path:${manifest.json_path}`); continue; }
      fixes = jsonFixRecords(payload, context);
      pages = jsonPagesToBuild(payload, context).filter(p => SUPPORTED_VERTICALS.has(p.vertical));
      parser = 'json';
    } else {
      const html = readText(manifest.html_path);
      const newFixText = htmlToText(extractSection(html, 'New Fixes'));
      const pendingText = htmlToText(extractSection(html, 'Pending Your Action'));
      const pagesText = htmlToText(extractSection(html, 'Pages to Build'));
      fixes = [...parseFixLines(newFixText, context), ...parseFixLines(pendingText, { ...context, pending_action: true })];
      pages = parsePagesToBuild(pagesText, context).filter(p => SUPPORTED_VERTICALS.has(p.vertical));
    }
    parsed.push({ manifest_path: manifestPath, html_path: manifest.html_path, json_path: manifest.json_path || '', parser, vertical, run_date: manifest.run_date, new_fix_count: fixes.filter(f => !f.pending_action).length, pending_fix_count: fixes.filter(f => f.pending_action).length, page_to_build_count: pages.length });
    allFixes.push(...fixes);
    allPages.push(...pages);
  }
  const dedupFixes = Array.from(new Map(allFixes.map(f => [`${f.page_url}|${f.query}|${f.fix_recommendation}`, f])).values());
  const dedupPages = Array.from(new Map(allPages.map(p => [`${p.vertical}|${p.query}`, p])).values());
  return { manifests, parsed, errors, fixes: dedupFixes, pages: dedupPages };
}
function main() {
  const discovered = parseReports();
  if (discovered.errors.length) {
    writeJson(REPORT_ARTIFACT, { schema_version: '1.0', status: 'FAIL', errors: discovered.errors, checked_at: DATE });
    console.error(`HTML REPORT CONTRACT FAIL: ${discovered.errors.join('; ')}`);
    process.exit(1);
  }
  const fixed = applyFixes(discovered.fixes);
  const queue = updateApprovalQueue(discovered.pages);
  const report = {
    schema_version: '1.0',
    status: 'PASS',
    generated_at: DATE,
    manifests_seen: discovered.manifests.length,
    report_summaries: discovered.parsed,
    fixes_discovered: discovered.fixes.length,
    fixes_applied: fixed.applied,
    external_fix_records: fixed.results.filter(r => r.status === 'EXTERNAL_TARGET_RECORDED').length,
    blocked_fix_records: fixed.results.filter(r => String(r.status).startsWith('BLOCKED')).length,
    pages_to_build_discovered: discovered.pages.length,
    approval_queue_added: queue.added_count,
    approval_queue_total: queue.total_count,
    approval_queue_skipped_existing: queue.skipped_count,
    fixes: fixed.results,
    page_specs: discovered.pages,
    approval_records_added: queue.added.map(row => ({ id: row.id, vertical: row.vertical, query: row.query, target_route: row.target_route, renderedPath: row.renderedPath || renderedPathForRoute(row.target_route), route_family: row.route_family || '', route_shape: row.route_shape || routeShape(row.target_route), route_authority: row.route_authority || '', admission_basis: row.admission_basis || '' })),
    approval_records_skipped: queue.skipped.map(row => ({ id: row.id, vertical: row.vertical, query: row.query, target_route: row.target_route, skipped_reason: row.skipped_reason, existing_route: row.existing_route || '' }))
  };
  writeJson(REPORT_DATA, report);
  writeJson(REPORT_ARTIFACT, report);
  console.log(`HTML REPORT CONTRACT PASS: fixes=${report.fixes_discovered}; applied=${report.fixes_applied}; external=${report.external_fix_records}; pages=${report.pages_to_build_discovered}; queued=${report.approval_queue_added}`);
}

if (require.main === module) main();

module.exports = { parseReports, applyFixes, updateApprovalQueue };
