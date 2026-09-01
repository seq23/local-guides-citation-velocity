#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { routePage, routeForFamily } = require('../lib/page_family_router');
const { routeShape, renderedPathForRoute } = require('../lib/page_family_authority');
const { resolveTargetPath, routeFromPath, statedFilepathFrom } = require('../lib/citation_route_resolver');
const { parseManifestBundle, canonicalDedupeKey } = require('../lib/agent_artifact_source_parser');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_TARGET = 125;
const MAX_TARGET = Number(process.env.VELOCITY_RELEASE_MAX || 150);
const REQUESTED_TARGET = process.env.VELOCITY_RELEASE_TARGET || process.argv[2] || DEFAULT_TARGET;
const TARGET = clampInt(REQUESTED_TARGET, 1, MAX_TARGET);
// A budget silently cut down to the ceiling is indistinguishable from a budget
// that was granted, and the rows above the line become CARRIED_NOT_WORKED with
// nothing in the log saying why. Say it out loud instead: the ceiling is a real
// safety limit, but the operator has to be able to see it bind.
if (Number.isFinite(Number.parseInt(String(REQUESTED_TARGET), 10))
  && Number.parseInt(String(REQUESTED_TARGET), 10) > MAX_TARGET) {
  console.warn(`VELOCITY RELEASE BUDGET TRUNCATED: requested ${REQUESTED_TARGET} rows but VELOCITY_RELEASE_MAX is ${MAX_TARGET}; ${Number.parseInt(String(REQUESTED_TARGET), 10) - MAX_TARGET} ready row(s) will be carried rather than worked. Raise VELOCITY_RELEASE_MAX to absorb them.`);
}
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const AGENT_ROOT = 'data/report_fixes/agent_runs';
const NORMALIZED_ROOT = 'data/report_fixes/normalized_agent_runs';
const SOURCE_LEDGER_ROOT = 'data/report_fixes/source_record_ledgers';
const LEDGER_PATH = 'data/report_fixes/agent_fix_ledger.json';
const POLICY_PATH = 'data/report_fixes/agent_exact_implementation_policy.json';

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
  'uscis-medical': 'uscis-medical',
  hair: 'trt',
  'hair-loss': 'trt',
  peptides: 'trt'
};

function clampInt(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}
function rel(...parts) { return path.join(ROOT, ...parts); }
function readJson(relativePath, fallback = null) {
  const p = rel(relativePath);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(relativePath, value) {
  const p = rel(relativePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
}
function readText(relativePath) { return fs.readFileSync(rel(relativePath), 'utf8'); }
function writeText(relativePath, value) {
  const p = rel(relativePath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, value, 'utf8');
}
function sha(value, len = 12) { return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, len); }
function fileHash(relativePath) {
  const p = rel(relativePath);
  if (!fs.existsSync(p)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function artifactIntegrity(relativePath) {
  if (!relativePath) return null;
  const p = rel(relativePath);
  if (!fs.existsSync(p)) return { path: relativePath, exists: false };
  const stat = fs.statSync(p);
  return { path: relativePath, exists: true, size_bytes: stat.size, sha256: fileHash(relativePath) };
}
function slugify(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90) || 'citation-question';
}
function normalizeVertical(value) {
  const key = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  return verticalMap[key] || verticalMap[key.replace(/-/g, ' ')] || key;
}
function boolish(value) {
  return ['y', 'yes', 'true', '1', 'needed', 'patch needed'].includes(String(value || '').trim().toLowerCase());
}
function scoreActionTier(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('free win')) return 100;
  if (v.includes('outperform')) return 85;
  if (v.includes('defend')) return 70;
  if (v.includes('monitor')) return 40;
  if (v.includes('none')) return 0;
  return 50;
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') { field += '"'; i += 1; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) { row.push(field); field = ''; }
    else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); if (row.some((cell) => String(cell).trim() !== '')) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => String(h || '').replace(/^\uFEFF/, '').trim());
  return rows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, String(cells[i] || '').trim()])));
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
function artifactErrors(manifest, manifestRel) {
  const errors = [];
  for (const key of ['source', 'run_date', 'vertical', 'csv_path', 'html_path', 'status']) if (!manifest[key]) errors.push(`${manifestRel}:missing:${key}`);
  for (const key of ['csv_path', 'html_path']) if (manifest[key] && !fs.existsSync(rel(manifest[key]))) errors.push(`${manifestRel}:missing-file:${manifest[key]}`);
  if (manifest.json_path && !fs.existsSync(rel(manifest.json_path))) errors.push(`${manifestRel}:missing-file:${manifest.json_path}`);
  if (manifest.html_path && !String(manifest.html_path).toLowerCase().endsWith('.html')) errors.push(`${manifestRel}:html_path_must_end_html:${manifest.html_path}`);
  if (manifest.json_path && !String(manifest.json_path).toLowerCase().endsWith('.json')) errors.push(`${manifestRel}:json_path_must_end_json:${manifest.json_path}`);
  if (manifest.status && !['READY_FOR_ABSORPTION', 'ABSORBED', 'QUARANTINED', 'IMPORTED'].includes(String(manifest.status))) errors.push(`${manifestRel}:bad-status:${manifest.status}`);
  if (manifest.status === 'QUARANTINED') {
    if (!manifest.quarantine_reason) errors.push(`${manifestRel}:quarantined-missing-reason`);
    if (!manifest.quarantine_action) errors.push(`${manifestRel}:quarantined-missing-action`);
    return errors;
  }
  for (const key of ['csv_path', 'html_path', 'json_path']) {
    if (manifest[key] && fs.existsSync(rel(manifest[key])) && isUnresolvedLocalFetch(rel(manifest[key]))) {
      errors.push(`${manifestRel}:unresolved-local-fetch-artifact:${manifest[key]}`);
    }
  }
  return errors;
}
function isUnresolvedLocalFetch(abs) {
  const text = fs.readFileSync(abs, 'utf8').trim();
  return /^\{\s*"_fetchBase64"\s*:\s*"local:\/\/agent\/current\/generated\//.test(text);
}
function questionFromRow(row) {
  return row.Query || row.query || row['Target Query'] || row['query_target'] || row.Question || row['Recommendation Query'] || '';
}
function desiredPageFromRow(row) {
  const repoFilePath = row['Repo File Path'] || row.repo_file_path || row['File Path'] || row.file_path || '';
  const intended = row['Intended Winner Page'] || row.url || row.URL || row.page || row['Target URL'] || row.target_page || '';
  // New 2026-06-29 agent artifacts may place a human title in Intended Winner Page
  // and the machine-resolvable URL in Repo File Path. Prefer the explicit path.
  return repoFilePath || intended;
}
function rowNeedsPatch(row) {
  if (boolish(row['Patch Needed (Y/N)'] || row.patch_needed)) return true;
  if (boolish(row['Gap Found'] || row.gap_found)) return true;
  const action = String(row['Action Tier'] || row.action_tier || '').toLowerCase();
  if (action && !action.includes('none') && !action.includes('monitor')) return true;
  return false;
}
function fixType(row) {
  return String(row['Primary Fix Type'] || row['Gap Type'] || row.fix_type || 'citation_gap').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'citation_gap';
}
function routeFor(vertical, question) {
  return routeForFamily(vertical, question, 'CREATE_COMMUNITY_QA');
}
function sourceRecordsFor(vertical) {
  return { personal_injury: ['SRC-CONGRESS-STATE-LEGISLATURES', 'SRC-CORNELL-SOL'], dentistry: ['SRC-ADA-MOUTHHEALTHY'], trt: ['SRC-FDA-TESTOSTERONE'], neuro: ['SRC-NIMH-ADHD'], 'uscis-medical': ['SRC-USCIS-I693'] }[vertical] || [];
}
function loadPolicy() {
  return readJson(POLICY_PATH, {
    schema_version: '1.0',
    effective_from: '9999-12-31',
    retroactive_processing: false,
    process_manifest_statuses: ['READY_FOR_ABSORPTION'],
    allowed_intended_winner_hosts: ['theindustryguides.com'],
    require_exact_intended_winner_resolution: true,
    allow_supporting_page_creation_after_repair: true,
    block_unresolved_patch_rows: true
  });
}
function manifestAllowedByPolicy(manifest, policy) {
  if (policy.retroactive_processing === false && manifest.run_date && policy.effective_from && manifest.run_date < policy.effective_from) return false;
  const status = String(manifest.status || '');
  const statuses = new Set(policy.process_manifest_statuses || ['READY_FOR_ABSORPTION']);
  if (statuses.has(status)) return true;
  // New vertical artifact bundles may arrive pre-marked ABSORBED with json_path and
  // normalized metadata. Treat these as idempotent current-run inputs after cutover,
  // not as retroactive historical runs. Re-importing them rewrites the same normalized
  // path and stable IDs, so scheduled runs remain deterministic.
  if (status === 'ABSORBED' && manifest.json_path && manifest.run_date && policy.effective_from && manifest.run_date >= policy.effective_from) return true;
  return false;
}
function repoPathFromIntendedWinnerPage(url, policy = loadPolicy()) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const parsed = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'https://theindustryguides.com');
    const allowed = new Set(policy.allowed_intended_winner_hosts || ['theindustryguides.com']);
    if (!allowed.has(parsed.hostname)) return null;
    let p = parsed.pathname.replace(/^\//, '');
    if (!p) p = 'index.html';
    if (p.endsWith('/')) p += 'index.html';
    return p;
  } catch {
    return raw.replace(/^\//, '');
  }
}
function routeFromRepoPath(repoPath) {
  if (!repoPath) return '';
  return '/' + String(repoPath).replace(/^\//, '');
}
function allowedHostFromUrl(url, policy) {
  const raw = String(url || '').trim();
  if (!raw) return true;
  try {
    const parsed = raw.startsWith('http') ? new URL(raw) : new URL(raw, 'https://theindustryguides.com');
    return new Set(policy.allowed_intended_winner_hosts || ['theindustryguides.com']).has(parsed.hostname);
  } catch { return true; }
}
function chooseAgentOperation(row, vertical, query, policy) {
  const desired = desiredPageFromRow(row);
  const patch = rowNeedsPatch(row);
  const intendedPath = repoPathFromIntendedWinnerPage(desired, policy);
  const supportDecision = routePage({ vertical, query, recommendation: row['Fix Recommendation'] || row.recommendation || '', operation: 'CREATE_NEW_TARGET_PAGE' });
  const supportingRoute = supportDecision.target_route || routeFor(vertical, query);
  if (patch && desired && !allowedHostFromUrl(desired, policy)) {
    return { operation: 'BLOCKED_EXTERNAL_DOMAIN', intended_winner_path: '', target_route: supportingRoute, renderedPath: '', supporting_route: '', blocked_reason: 'intended_winner_page_not_on_allowed_host', status: 'BLOCKED_EXTERNAL_DOMAIN' };
  }
  if (patch && intendedPath) {
    // The query and the vertical are evidence, and withholding them was the whole
    // defect: the free_wins and outperform sections name a page by TITLE, never by
    // path, so resolveTargetPath was handed a percent-encoded pseudo-path with no
    // way to tell which page it meant. 22 rows across the 2026-07-29 and 2026-08-05
    // TRT runs were recorded BLOCKED_MISSING_TARGET against pages that existed.
    let resolved = resolveTargetPath({ value: intendedPath, query, family: vertical });
    // THE AGENT WROTE THE PATH DOWN; USE IT.
    //
    // These sections carry a human title in the winner field and the real path inside
    // the recommendation ("FILEPATH: trt/index.html || CURRENT: ..."). When the title
    // resolves to nothing, the explicit FILEPATH is not a fallback guess - it is the
    // agent naming its own target, and it outranks a title that matched no page. Three
    // 2026-08-05 TRT free wins sat BLOCKED_MISSING_TARGET for five weeks with
    // `trt/index.html` written in plain text one field away.
    if (resolved.block_reason) {
      const stated = statedFilepathFrom(row['Fix Recommendation'] || row.recommendation || row.fix_recommendation || '');
      if (stated) {
        const fromStatedPath = resolveTargetPath({ value: stated, query, family: vertical });
        if (!fromStatedPath.block_reason) resolved = { ...fromStatedPath, canonicalized_from: [...(fromStatedPath.canonicalized_from || []), intendedPath], status: `${fromStatedPath.status}_VIA_STATED_FILEPATH` };
      }
    }
    if (!resolved.block_reason) return { operation: 'REPAIR_INTENDED_WINNER_PAGE', intended_winner_path: resolved.implementation_path, target_route: routeFromPath(resolved.implementation_path), renderedPath: resolved.implementation_path, supporting_route: supportingRoute, blocked_reason: '', status: 'READY_TO_RELEASE', target_resolution_status: resolved.status, canonicalized_from: resolved.canonicalized_from || [], route_family: 'REPAIR_EXISTING', route_reason: 'existing_target_repair', route_shape: routeShape(routeFromPath(resolved.implementation_path)), route_authority: 'artifact_admitted', admission_basis: 'AGENT_EXACT_REPAIR_TARGET' };
    return { operation: 'BLOCKED_MISSING_TARGET', intended_winner_path: intendedPath, target_route: routeFromRepoPath(intendedPath), renderedPath: intendedPath, supporting_route: supportingRoute, blocked_reason: resolved.block_reason || 'intended_winner_page_not_found_in_repo', status: 'BLOCKED_MISSING_TARGET', target_resolution_status: resolved.status };
  }
  const routeDecision = routePage({ vertical, query, recommendation: row['Fix Recommendation'] || row.recommendation || '', operation: 'CREATE_NEW_TARGET_PAGE' });
  if (String(routeDecision.status || '').startsWith('BLOCKED_')) return { operation: routeDecision.status, intended_winner_path: intendedPath || '', target_route: '', renderedPath: '', supporting_route: '', blocked_reason: routeDecision.blocked_reason || routeDecision.status, status: routeDecision.status, route_family: routeDecision.family };
  return { operation: 'CREATE_NEW_TARGET_PAGE', intended_winner_path: intendedPath || '', target_route: routeDecision.target_route, renderedPath: routeDecision.renderedPath || renderedPathForRoute(routeDecision.target_route), supporting_route: '', blocked_reason: '', status: 'READY_TO_RELEASE', route_family: routeDecision.family, route_reason: routeDecision.reason, route_shape: routeDecision.route_shape || routeShape(routeDecision.target_route), route_authority: routeDecision.route_authority || 'artifact_admitted', admission_basis: 'AGENT_ARTIFACT_NEW_PAGE' };
}
function toApproval(record) {
  return {
    id: record.id,
    status: 'APPROVED',
    source: record.source,
    source_run_id: record.source_run_id,
    vertical: record.vertical,
    query: record.query,
    normalized_query: record.query,
    llm_bait_phrase: record.query,
    intended_winner_page: record.intended_winner_page,
    intended_winner_path: record.intended_winner_path || '',
    operation: record.operation || 'CREATE_NEW_TARGET_PAGE',
    supporting_route: record.supporting_route || '',
    blocked_reason: record.blocked_reason || '',
    fix_type: record.fix_type,
    action_tier: record.action_tier,
    priority_score: record.priority_score,
    source_records: record.source_records,
    source_signal_ids: record.source_signal_ids,
    citation_velocity: true,
    recommended_action: record.recommendation,
    status_reason: record.status_reason || 'selected_for_velocity_intake_release',
    target_route: record.target_route,
    renderedPath: record.renderedPath || renderedPathForRoute(record.target_route),
    route_family: record.route_family || '',
    route_reason: record.route_reason || '',
    route_shape: record.route_shape || routeShape(record.target_route),
    route_authority: record.route_authority || 'artifact_admitted',
    admission_basis: record.admission_basis || (record.source === 'social_public_backlog' ? 'SOCIAL_BACKLOG_APPROVED_FALLBACK' : 'VELOCITY_INTAKE_SELECTED')
  };
}

function sourceRecordMatchesRecord(record, sourceRecord) {
  const queryA = String(record.query || '').trim().toLowerCase();
  const queryB = String(sourceRecord.query || '').trim().toLowerCase();
  if (!queryA || !queryB || queryA !== queryB) return false;
  const targetA = String(record.intended_winner_path || record.intended_winner_page || record.target_route || '').replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '').toLowerCase();
  const targetB = String(sourceRecord.repo_file_path || sourceRecord.target_url || '').replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '').toLowerCase();
  return !targetB || !targetA || targetA.includes(targetB) || targetB.includes(targetA);
}
function writeSourceRecordLedger(manifestRel, manifest, sourceBundle) {
  const vertical = normalizeVertical(manifest.vertical);
  const records = sourceBundle.records || [];
  const byKey = new Map();
  for (const record of records) {
    const key = record.canonical_key || canonicalDedupeKey(record);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(record.source_record_id);
  }
  const duplicateGroups = [...byKey.entries()].filter(([, ids]) => ids.length > 1).map(([canonical_key, source_record_ids]) => ({ canonical_key, source_record_ids, source_record_count: source_record_ids.length }));
  const ledger = {
    schema_version: '1.0',
    manifest: manifestRel,
    run_date: manifest.run_date,
    vertical,
    source_record_count: records.length,
    recommendation_record_count: records.filter(r => r.recommendation_text).length,
    new_page_opportunity_count: records.filter(r => r.recommendation_type === 'new_page_opportunity').length,
    existing_page_fix_count: records.filter(r => r.recommendation_type === 'existing_page_fix').length,
    records,
    dedupe_groups: duplicateGroups,
    errors: sourceBundle.errors || []
  };
  const ledgerRel = `${SOURCE_LEDGER_ROOT}/${manifest.run_date}_${vertical}.json`;
  writeJson(ledgerRel, ledger);
  writeJson(`${SOURCE_LEDGER_ROOT}/latest.json`, { ...ledger, latest_ledger: ledgerRel });
  return ledger;
}
function recordFromSourceRecord(sourceRecord, manifest, manifestRel, runId, sourceIndex, policy) {
  const vertical = normalizeVertical(sourceRecord.vertical || manifest.vertical);
  const query = sourceRecord.query;
  const fake = {
    Query: query,
    'Repo File Path': sourceRecord.repo_file_path || sourceRecord.target_url || '',
    'Intended Winner Page': sourceRecord.target_url || sourceRecord.repo_file_path || '',
    'Action Tier': sourceRecord.action_tier || (sourceRecord.recommendation_type === 'new_page_opportunity' ? 'free win' : 'page fix'),
    'Gap Type': sourceRecord.gap_type || sourceRecord.recommendation_type,
    'Fix Recommendation': sourceRecord.recommendation_text,
    patch_needed: sourceRecord.recommendation_type === 'existing_page_fix' ? 'Y' : ''
  };
  const decision = sourceRecord.recommendation_type === 'new_page_opportunity'
    ? chooseAgentOperation({ ...fake, 'Repo File Path': '', 'Intended Winner Page': '' }, vertical, query, policy)
    : chooseAgentOperation(fake, vertical, query, policy);
  const priority = scoreActionTier(fake['Action Tier']) + (sourceRecord.recommendation_text ? 8 : 0);
  return {
    id: `agent_${sha(sourceRecord.source_record_id, 16)}`,
    source: 'twin_agent_artifact',
    source_run_id: runId,
    source_artifacts: { manifest: manifestRel, csv: manifest.csv_path, html: manifest.html_path, json: manifest.json_path || '' },
    source_record_id: sourceRecord.source_record_id,
    source_record_ids: [sourceRecord.source_record_id],
    source_record_canonical_key: sourceRecord.canonical_key,
    source_section: sourceRecord.source_section,
    source_file: sourceRecord.source_file,
    recommendation_fields: sourceRecord.recommendation_fields || {},
    run_date: manifest.run_date,
    vertical,
    query,
    intended_winner_page: sourceRecord.target_url || sourceRecord.repo_file_path || '',
    intended_winner_path: decision.intended_winner_path || '',
    cited_sources: '',
    answer_shape: '',
    gap_type: sourceRecord.gap_type || sourceRecord.recommendation_type,
    fix_type: sourceRecord.recommendation_type === 'existing_page_fix' ? 'agent_source_page_fix' : 'agent_source_new_page',
    action_tier: sourceRecord.action_tier || '',
    recommendation: sourceRecord.recommendation_text || `Build a citation-ready answer page for ${query}.`,
    patch_needed: sourceRecord.recommendation_type === 'existing_page_fix',
    operation: sourceRecord.recommendation_type === 'existing_page_fix' ? decision.operation : 'CREATE_NEW_TARGET_PAGE',
    target_route: decision.target_route,
    supporting_route: decision.supporting_route || '',
    renderedPath: decision.renderedPath || '',
    blocked_reason: decision.blocked_reason || '',
    target_resolution_status: decision.target_resolution_status || '',
    canonicalized_from: decision.canonicalized_from || [],
    route_family: decision.route_family || '',
    route_reason: decision.route_reason || '',
    priority_score: priority,
    source_signal_ids: [`${runId}_source_${sourceIndex}`],
    source_records: sourceRecordsFor(vertical),
    status: decision.status || 'READY_TO_RELEASE'
  };
}

function importAgentRuns() {
  const policy = loadPolicy();
  const manifests = walkManifests();
  const normalized = [];
  const invalid = [];
  const absorbed = [];
  const skipped_by_policy = [];
  for (const manifestRel of manifests) {
    let manifest;
    try { manifest = readJson(manifestRel); } catch (err) { invalid.push({ manifest: manifestRel, error: `invalid_json:${err.message}` }); continue; }
    const errors = artifactErrors(manifest, manifestRel);
    if (errors.length) { invalid.push({ manifest: manifestRel, errors }); continue; }
    if (!manifestAllowedByPolicy(manifest, policy)) {
      if (String(manifest.status) === 'QUARANTINED') skipped_by_policy.push({ manifest: manifestRel, run_date: manifest.run_date, reason: 'quarantined_agent_artifacts', quarantine_reason: manifest.quarantine_reason || '' });
      if (String(manifest.status) === 'READY_FOR_ABSORPTION') skipped_by_policy.push({ manifest: manifestRel, run_date: manifest.run_date, reason: 'before_exact_implementation_cutover' });
      continue;
    }
    const sourceBundle = parseManifestBundle({ manifestPath: manifestRel, root: ROOT });
    const sourceLedger = writeSourceRecordLedger(manifestRel, manifest, sourceBundle);
    const sourceRecords = sourceLedger.records || [];
    const rows = parseCsv(readText(manifest.csv_path));
    const vertical = normalizeVertical(manifest.vertical);
    const runId = `${manifest.run_date}_${vertical}_${sha(manifest.csv_path)}`;
    const records = [];
    rows.forEach((row, index) => {
      const query = questionFromRow(row);
      if (!query || query.length < 8 || !rowNeedsPatch(row)) return;
      const desired = desiredPageFromRow(row);
      const sourceKey = `${manifest.csv_path}:${index}:${query}:${desired}`;
      const priority = scoreActionTier(row['Action Tier']) + Math.max(0, 5 - Number(row['Progress Level (1-4)'] || 4)) * 5;
      const decision = chooseAgentOperation(row, vertical, query, policy);
      const matchedSourceRecords = sourceRecords.filter((sourceRecord) => sourceRecordMatchesRecord({ query, intended_winner_page: desired, target_route: decision.target_route, intended_winner_path: decision.intended_winner_path }, sourceRecord));
      const primarySourceRecord = matchedSourceRecords[0] || null;
      records.push({
        id: `agent_${sha(sourceKey, 16)}`,
        source: 'twin_agent_artifact',
        source_run_id: runId,
        source_artifacts: { manifest: manifestRel, csv: manifest.csv_path, html: manifest.html_path, json: manifest.json_path || '' },
        source_record_id: primarySourceRecord ? primarySourceRecord.source_record_id : '',
        source_record_ids: matchedSourceRecords.map((sourceRecord) => sourceRecord.source_record_id),
        source_record_canonical_key: primarySourceRecord ? primarySourceRecord.canonical_key : '',
        source_section: primarySourceRecord ? primarySourceRecord.source_section : 'csv',
        source_file: primarySourceRecord ? primarySourceRecord.source_file : manifest.csv_path,
        recommendation_fields: primarySourceRecord ? (primarySourceRecord.recommendation_fields || {}) : {},
        run_date: manifest.run_date,
        vertical,
        query,
        intended_winner_page: desired,
        intended_winner_path: decision.intended_winner_path || '',
        cited_sources: row['Cited Sources'] || '',
        answer_shape: row['Answer Shape'] || '',
        gap_type: row['Gap Type'] || '',
        fix_type: fixType(row),
        action_tier: row['Action Tier'] || '',
        recommendation: row['Fix Recommendation'] || '',
        patch_needed: rowNeedsPatch(row),
        operation: decision.operation,
        target_route: decision.target_route,
        supporting_route: decision.supporting_route || '',
        renderedPath: decision.renderedPath || '',
        blocked_reason: decision.blocked_reason || '',
        target_resolution_status: decision.target_resolution_status || '',
        canonicalized_from: decision.canonicalized_from || [],
        route_family: decision.route_family || '',
        route_reason: decision.route_reason || '',
        priority_score: priority,
        source_signal_ids: [`${runId}_${index}`],
        source_records: sourceRecordsFor(vertical),
        status: decision.status || 'READY_TO_RELEASE'
      });
    });
    const representedSourceIds = new Set(records.flatMap((record) => record.source_record_ids || []).filter(Boolean));
    sourceRecords.forEach((sourceRecord, sourceIndex) => {
      if (!sourceRecord.query || representedSourceIds.has(sourceRecord.source_record_id)) return;
      if (!['existing_page_fix', 'new_page_opportunity', 'outperform', 'authority'].includes(sourceRecord.recommendation_type)) return;
      const extra = recordFromSourceRecord(sourceRecord, manifest, manifestRel, runId, sourceIndex, policy);
      if (!extra.query || !extra.target_route && !String(extra.status || '').startsWith('BLOCKED_')) return;
      records.push(extra);
      representedSourceIds.add(sourceRecord.source_record_id);
    });
    if (records.length) {
      const normalizedRel = `${NORMALIZED_ROOT}/${manifest.run_date}_${vertical}.json`;
      const artifact_integrity = {
        manifest: artifactIntegrity(manifestRel),
        csv: artifactIntegrity(manifest.csv_path),
        html: artifactIntegrity(manifest.html_path),
        json: artifactIntegrity(manifest.json_path || '')
      };
      writeJson(normalizedRel, { schema_version: '1.4', source_ledger_path: `${SOURCE_LEDGER_ROOT}/${manifest.run_date}_${vertical}.json`, run_id: runId, manifest: manifestRel, csv_path: manifest.csv_path, html_path: manifest.html_path, json_path: manifest.json_path || '', record_count: records.length, raw_artifact_count: Object.values(artifact_integrity).filter((x)=>x&&x.exists).length, artifact_integrity, policy_path: POLICY_PATH, records });
      normalized.push(...records);
      // Raw agent artifacts are immutable evidence. Absorption state is recorded in generated ledgers, never by editing the source manifest.
      absorbed.push({ manifest: manifestRel, run_id: runId, record_count: records.length, normalized_path: normalizedRel, disposition: 'NORMALIZED_WITH_RAW_IMMUTABLE' });
    }
  }
  return { manifests, normalized, invalid, absorbed, skipped_by_policy };
}
// Depth of the social/public backlog that is ELIGIBLE but unreleased, measured
// independently of this run's remaining capacity.
//
// social_fallback_suppressed_count is bounded by (TARGET - selected.length), so
// on any run where agent artifacts already fill the target it reports 0 -- and a
// human reading the plan sees "suppressed: 0" while a real backlog sits idle.
// That is technically accurate and practically misleading: it is the difference
// between "nothing is being held back" and "nothing more fits today".
function measureSocialFallbackBacklogDepth(existingIds) {
  const queue = readJson('data/community/publish_queue.json', []);
  if (!Array.isArray(queue)) return 0;
  let depth = 0;
  for (const row of queue) {
    if (!row || !row.query || existingIds.has(row.id)) continue;
    const vertical = normalizeVertical(row.vertical || row.target_vertical || '');
    const query = String(row.query || row.normalized_query || '').trim();
    if (query.length >= 20 && ['personal_injury', 'dentistry', 'trt', 'neuro', 'uscis-medical'].includes(vertical)) depth += 1;
  }
  return depth;
}

function countSocialFallbackCandidates(limit, existingIds) {
  if (limit <= 0) return 0;
  const queue = readJson('data/community/publish_queue.json', []);
  if (!Array.isArray(queue)) return 0;
  let count = 0;
  for (const row of queue) {
    if (!row || !row.query || existingIds.has(row.id)) continue;
    const vertical = normalizeVertical(row.vertical || row.target_vertical || '');
    const query = String(row.query || row.normalized_query || '').trim();
    if (query.length >= 20 && ['personal_injury', 'dentistry', 'trt', 'neuro', 'uscis-medical'].includes(vertical)) count += 1;
    if (count >= limit) return count;
  }
  return count;
}
function socialFallbackRecords(limit, existingIds, existingTitles = new Set(), existingRoutes = new Set()) {
  if (limit <= 0) return [];
  const queue = readJson('data/community/publish_queue.json', []);
  if (!Array.isArray(queue)) return [];
  return queue
    .filter((row) => row && row.query && !existingIds.has(row.id))
    .map((row) => {
      const vertical = normalizeVertical(row.vertical || row.target_vertical || '');
      const query = String(row.query || row.normalized_query || '').trim();
      const routeDecision = routePage({ vertical, query, recommendation: row.recommended_action || '', operation: 'CREATE_NEW_TARGET_PAGE' });
      const targetRoute = routeDecision.target_route || routeFor(vertical, query);
      if (existingTitles.has(query.toLowerCase()) || existingRoutes.has(targetRoute)) return null;
      return {
        id: `social_${sha(row.id || query, 16)}`,
        source: 'social_public_backlog',
        source_run_id: 'social_backlog',
        vertical,
        query,
        normalized_query: query,
        intended_winner_page: '',
        intended_winner_path: '',
        operation: 'CREATE_NEW_TARGET_PAGE',
        fix_type: row.intent_type || 'public_signal_question',
        action_tier: 'social_backlog_fill',
        recommendation: row.recommended_action || 'Create citation-ready exact-answer page from public/social backlog signal.',
        priority_score: Number(row.signal_score || 0) * 10,
        target_route: targetRoute,
        renderedPath: routeDecision.renderedPath || renderedPathForRoute(targetRoute),
        route_family: routeDecision.family || 'CREATE_COMMUNITY_QA',
        route_shape: routeDecision.route_shape || routeShape(targetRoute),
        route_authority: 'strategy_gap_fill_admitted',
        admission_basis: 'SOCIAL_BACKLOG_APPROVED_FALLBACK',
        source_artifacts: {
          strategy_gap_fill_backlog: 'data/strategy/strategy_gap_fill_backlog.json',
          approval_queue: 'data/community/approval_queue.json',
          live_signal_queries: 'content/_staged/live_signal_queries.json'
        },
        source_signal_ids: row.source_signal_ids || [row.id].filter(Boolean),
        source_records: sourceRecordsFor(vertical),
        status: 'READY_TO_RELEASE',
        status_reason: 'fallback_from_social_backlog'
      };
    })
    .filter((row) => row && row.query.length >= 20 && ['personal_injury', 'dentistry', 'trt', 'neuro', 'uscis-medical'].includes(row.vertical))
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, limit);
}
function existingTitleSet() {
  const titles = new Set();
  for (const file of ['content/_live/pages.json', 'content/_staged/pages.json', 'content/_live/insights.json']) {
    const payload = readJson(file, {});
    for (const item of [...(payload.pages || []), ...(payload.items || [])]) {
      const title = String(item.title || item.visible_q || item.query || '').trim().toLowerCase();
      if (title) titles.add(title);
    }
  }
  return titles;
}
function existingRouteSet() {
  const routes = new Set();
  for (const file of ['content/_live/pages.json', 'content/_staged/pages.json', 'content/_live/insights.json']) {
    const payload = readJson(file, {});
    for (const item of [...(payload.pages || []), ...(payload.items || [])]) {
      const route = item.slug || item.path || item.publish_path || '';
      if (route) routes.add(routeFromPath(renderedPathForRoute(route)).replace(/\/index\.html$/, '/'));
      const rendered = item.renderedPath || item.path || item.publish_path || '';
      if (rendered) routes.add(routeFromPath(rendered).replace(/\/index\.html$/, '/'));
    }
  }
  return routes;
}
function updateLedger(agentRecords, plan) {
  const current = readJson(LEDGER_PATH, { schema_version: '1.0', ledger_type: 'cumulative_agent_fix_ledger', fixes: [] });
  const byId = new Map((current.fixes || []).map((fix) => [fix.id, fix]));
  const selected = new Set(plan.selected_ids || []);
  for (const record of agentRecords) {
    const selectedForRelease = selected.has(record.id);
    const prior = byId.get(record.id) || {};
    const completed = ['RELEASED_VERIFIED','APPLIED_VERIFIED'].includes(String(prior.implementation_status || ''));
    byId.set(record.id, {
      ...prior,
      id: record.id,
      run_date: record.run_date,
      vertical: record.vertical,
      query: record.query,
      intended_winner_page: record.intended_winner_page,
      intended_winner_path: record.intended_winner_path || '',
      target_route: record.target_route,
      supporting_route: record.supporting_route || '',
      operation: record.operation || 'CREATE_NEW_TARGET_PAGE',
      blocked_reason: record.blocked_reason || '',
      fix_type: record.fix_type,
      action_tier: record.action_tier,
      source_artifacts: record.source_artifacts,
      source_record_id: record.source_record_id || '',
      source_record_ids: record.source_record_ids || [],
      source_record_canonical_key: record.source_record_canonical_key || '',
      recommendation_fields: record.recommendation_fields || {},
      implementation_status: completed ? prior.implementation_status : (selectedForRelease ? (record.operation || 'SELECTED_FOR_RELEASE') : (String(record.status || '').startsWith('BLOCKED_') || String(record.status || '').startsWith('SKIPPED_') ? record.status : 'QUEUED_FOR_FUTURE_RELEASE')),
      trace_required: selectedForRelease,
      sourceFiles: record.operation === 'REPAIR_INTENDED_WINNER_PAGE' ? ['content/_live/insights.json'] : ['content/_staged/pages.json', 'content/_live/pages.json'],
      liveManifestPath: record.operation === 'REPAIR_INTENDED_WINNER_PAGE' ? 'content/_live/insights.json' : 'content/_live/pages.json',
      stagedManifestPath: record.operation === 'REPAIR_INTENDED_WINNER_PAGE' ? '' : 'content/_staged/pages.json',
      renderedPath: record.renderedPath || record.target_route.replace(/^\//, '').replace(/\/$/, '/index.html'),
      before_hash: record.renderedPath ? fileHash(record.renderedPath) : null,
      required_markers: [record.query]
    });
  }
  current.updated_at = DATE;
  current.fix_count = byId.size;
  current.fixes = Array.from(byId.values()).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  writeJson(LEDGER_PATH, current);
}
function writeDispositionLedger(agentRecords, plan) {
  const selected = new Set(plan.selected_ids || []);
  const entries = (agentRecords || []).map((record) => {
    let disposition = 'QUEUED_FOR_FUTURE_RELEASE';
    if (selected.has(record.id)) disposition = 'SELECTED_FOR_RELEASE';
    else if (String(record.status || '').startsWith('BLOCKED_') || String(record.operation || '').startsWith('BLOCKED_')) disposition = 'BLOCKED';
    else if (String(record.status || '').startsWith('SKIPPED_')) disposition = 'SKIPPED';
    return {
      id: record.id,
      source_record_id: record.source_record_id || '',
      source_record_ids: record.source_record_ids || [],
      source_record_canonical_key: record.source_record_canonical_key || '',
      run_date: record.run_date,
      vertical: record.vertical,
      query: record.query,
      operation: record.operation || '',
      target_route: record.target_route || '',
      intended_winner_path: record.intended_winner_path || '',
      supporting_route: record.supporting_route || '',
      disposition,
      status: record.status || '',
      status_reason: record.status_reason || '',
      blocked_reason: record.blocked_reason || '',
      source_section: record.source_section || '',
      source_file: record.source_file || '',
      selected_for_release: selected.has(record.id)
    };
  }).sort((a, b) => String(a.run_date).localeCompare(String(b.run_date)) || String(a.vertical).localeCompare(String(b.vertical)) || String(a.id).localeCompare(String(b.id)));
  const counts = entries.reduce((acc, entry) => {
    acc[entry.disposition] = (acc[entry.disposition] || 0) + 1;
    return acc;
  }, {});
  writeJson('data/report_fixes/agent_artifact_disposition_ledger.json', {
    schema_version: '1.0',
    status: 'PASS',
    updated_at: DATE,
    source: 'prepare_velocity_intake_release',
    entry_count: entries.length,
    counts,
    entries
  });
}
function main() {
  const agent = importAgentRuns();
  if (agent.invalid.length) {
    writeJson('artifacts/validation/agent-run-intake-errors.json', { schema_version: '1.0', status: 'FAIL', errors: agent.invalid, checked_at: DATE });
    console.error('Agent run intake has invalid artifacts.');
    for (const err of agent.invalid) console.error(JSON.stringify(err));
    process.exit(1);
  }
  const selected = [];
  const seenRoutes = new Set();
  const seenIds = new Set();
  const existingTitles = existingTitleSet();
  const existingRoutes = existingRouteSet();
  const blockedAgent = agent.normalized.filter((r) => String(r.status || '').startsWith('BLOCKED_'));
  const existingFixLedger = readJson(LEDGER_PATH, { fixes: [] });
  const completedIds = new Set((existingFixLedger.fixes || []).filter((fix) => ['RELEASED_VERIFIED','APPLIED_VERIFIED'].includes(String(fix.implementation_status || ''))).map((fix) => fix.id));
  const orderedAgent = agent.normalized.filter((r) => r.status === 'READY_TO_RELEASE' && !completedIds.has(r.id)).sort((a, b) => String(b.run_date || '').localeCompare(String(a.run_date || '')) || b.priority_score - a.priority_score || String(a.id).localeCompare(String(b.id)));
  for (const record of orderedAgent) {
    if (selected.length >= TARGET) break;
    if (record.operation === 'CREATE_NEW_TARGET_PAGE' && existingTitles.has(String(record.query || '').trim().toLowerCase())) {
      record.status = 'SKIPPED_EXISTING_WITH_PROOF';
      record.status_reason = 'exact_title_already_exists_in_pages';
      continue;
    }
    const routeKey = record.operation === 'REPAIR_INTENDED_WINNER_PAGE' ? `repair:${record.intended_winner_path}` : record.target_route;
    if (seenRoutes.has(routeKey)) { record.status = 'SKIPPED_DUPLICATE_WITH_PROOF'; record.status_reason = 'canonical_route_already_selected'; continue; }
    selected.push(record); seenRoutes.add(routeKey); seenIds.add(record.id);
  }
  const allowSocialFallbackRelease = process.env.ALLOW_SOCIAL_FALLBACK_RELEASE !== '0';
  const socialCapacity = TARGET - selected.length;
  const social = allowSocialFallbackRelease ? socialFallbackRecords(socialCapacity, seenIds, existingTitles, existingRoutes) : [];
  for (const record of social) {
    if (selected.length >= TARGET) break;
    if (seenRoutes.has(record.target_route)) continue;
    selected.push(record); seenRoutes.add(record.target_route); seenIds.add(record.id);
  }
  const suppressedSocialFallbackCount = allowSocialFallbackRelease ? 0 : countSocialFallbackCandidates(TARGET - selected.length, seenIds);
  const socialFallbackBacklogDepth = measureSocialFallbackBacklogDepth(seenIds);
  const approvals = selected.map(toApproval);
  writeJson('data/community/approval_queue.json', approvals);
  const plan = {
    schema_version: '1.2',
    status: 'PASS',
    release_date: DATE,
    target_publish_units: TARGET,
    processing_budget_units: TARGET,
    processing_budget_is_not_quota: true,
    selected_count: selected.length,
    agent_selected_count: selected.filter((r) => r.source === 'twin_agent_artifact').length,
    social_fallback_selected_count: selected.filter((r) => r.source === 'social_public_backlog').length,
    social_fallback_release_allowed: allowSocialFallbackRelease,
    social_fallback_release_required: false,
    social_fallback_release_policy: allowSocialFallbackRelease ? 'EXPLICITLY_ENABLED' : 'DISABLED_BY_DEFAULT_SAFE_HARBOR_AGENT_FIRST',
    strategy_gap_fill_required: false,
    social_fallback_suppressed_count: suppressedSocialFallbackCount,
    social_fallback_suppressed_reason: allowSocialFallbackRelease ? '' : 'fallback disabled by Safe Harbor contract; processing budget is not a publication quota',
    social_fallback_backlog_depth: socialFallbackBacklogDepth,
    repair_count: selected.filter((r) => r.operation === 'REPAIR_INTENDED_WINNER_PAGE').length,
    new_page_count: selected.filter((r) => r.operation === 'CREATE_NEW_TARGET_PAGE').length,
    blocked_count: blockedAgent.length,
    supporting_page_count: selected.filter((r) => r.supporting_route).length,
    manifests_seen: agent.manifests.length,
    manifests_absorbed: agent.absorbed,
    skipped_by_policy: agent.skipped_by_policy,
    blocked_agent_rows: blockedAgent.map((r) => ({ id: r.id, query: r.query, operation: r.operation, intended_winner_page: r.intended_winner_page, blocked_reason: r.blocked_reason })),
    selected_ids: selected.map((r) => r.id),
    selected_units: selected.map((r) => ({ id: r.id, source: r.source, operation: r.operation || 'CREATE_NEW_TARGET_PAGE', vertical: r.vertical, query: r.query, intended_winner_page: r.intended_winner_page || '', intended_winner_path: r.intended_winner_path || '', target_route: r.target_route, renderedPath: r.renderedPath || renderedPathForRoute(r.target_route), supporting_route: r.supporting_route || '', route_family: r.route_family || '', route_shape: r.route_shape || routeShape(r.target_route), route_authority: r.route_authority || 'artifact_admitted', admission_basis: r.admission_basis || 'VELOCITY_INTAKE_SELECTED', priority_score: r.priority_score }))
  };
  updateLedger(agent.normalized, plan);
  writeDispositionLedger(agent.normalized, plan);
  writeJson('artifacts/validation/velocity-intake-release-plan.json', plan);
  writeText('artifacts/validation/velocity-intake-release-plan.md', [
    '# Velocity Intake Release Plan', '',
    `Status: **${plan.status}**`,
    `Release date: ${DATE}`,
    `Target publish units: ${TARGET}`,
    `Selected units: ${plan.selected_count}`,
    `Twin agent units: ${plan.agent_selected_count}`,
    `Social fallback units: ${plan.social_fallback_selected_count}`,
    `Social fallback allowed: ${plan.social_fallback_release_allowed}`,
    `Social fallback suppressed: ${plan.social_fallback_suppressed_count}`,
    `Social fallback backlog depth (eligible, unreleased): ${plan.social_fallback_backlog_depth}`,
    `Repair units: ${plan.repair_count}`,
    `New page units: ${plan.new_page_count}`,
    '', '| Source | Operation | Vertical | Target route | Query |', '|---|---|---|---|---|',
    ...plan.selected_units.map((u) => `| ${u.source} | ${u.operation} | ${u.vertical} | ${u.target_route} | ${String(u.query).replace(/\|/g, '\\|')} |`)
  ].join('\n') + '\n');
  writeJson('artifacts/validation/agent-run-intake.json', { schema_version: '1.1', status: 'PASS', manifests_seen: agent.manifests.length, absorbed: agent.absorbed, skipped_by_policy: agent.skipped_by_policy, blocked_count: blockedAgent.length, invalid: [], checked_at: DATE });
  console.log(`VELOCITY INTAKE PREP PASS: ${plan.selected_count} units (${plan.agent_selected_count} agent, ${plan.social_fallback_selected_count} social fallback, ${plan.repair_count} repairs; social_fallback_policy=${plan.social_fallback_release_policy}).`);
}

if (require.main === module) main();
