#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const DEFAULT_TARGET = 125;
const MAX_TARGET = Number(process.env.VELOCITY_RELEASE_MAX || 150);
const TARGET = clampInt(process.env.VELOCITY_RELEASE_TARGET || process.argv[2] || DEFAULT_TARGET, 1, MAX_TARGET);
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const AGENT_ROOT = 'data/report_fixes/agent_runs';
const NORMALIZED_ROOT = 'data/report_fixes/normalized_agent_runs';
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
  if (manifest.html_path && !String(manifest.html_path).toLowerCase().endsWith('.html')) errors.push(`${manifestRel}:html_path_must_end_html:${manifest.html_path}`);
  if (manifest.status && !['READY_FOR_ABSORPTION', 'ABSORBED', 'QUARANTINED', 'IMPORTED'].includes(String(manifest.status))) errors.push(`${manifestRel}:bad-status:${manifest.status}`);
  return errors;
}
function questionFromRow(row) {
  return row.Query || row.query || row['Target Query'] || row['query_target'] || row.Question || row['Recommendation Query'] || '';
}
function desiredPageFromRow(row) {
  return row['Intended Winner Page'] || row.url || row.URL || row.page || row['Target URL'] || row.target_page || '';
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
  return `/${String(vertical).replace(/_/g, '-')}/community-questions/${slugify(question)}/`;
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
  const statuses = new Set(policy.process_manifest_statuses || ['READY_FOR_ABSORPTION']);
  if (!statuses.has(String(manifest.status))) return false;
  if (policy.retroactive_processing === false && manifest.run_date && policy.effective_from && manifest.run_date < policy.effective_from) return false;
  return true;
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
  const supportingRoute = routeFor(vertical, query);
  if (patch && desired && !allowedHostFromUrl(desired, policy)) {
    return { operation: 'BLOCKED_EXTERNAL_DOMAIN', intended_winner_path: '', target_route: supportingRoute, renderedPath: '', supporting_route: '', blocked_reason: 'intended_winner_page_not_on_allowed_host', status: 'BLOCKED_EXTERNAL_DOMAIN' };
  }
  if (patch && intendedPath && fs.existsSync(rel(intendedPath))) {
    return { operation: 'REPAIR_INTENDED_WINNER_PAGE', intended_winner_path: intendedPath, target_route: routeFromRepoPath(intendedPath), renderedPath: intendedPath, supporting_route: supportingRoute, blocked_reason: '', status: 'READY_TO_RELEASE' };
  }
  if (patch && intendedPath && !fs.existsSync(rel(intendedPath))) {
    return { operation: 'BLOCKED_MISSING_TARGET', intended_winner_path: intendedPath, target_route: routeFromRepoPath(intendedPath), renderedPath: intendedPath, supporting_route: supportingRoute, blocked_reason: 'intended_winner_page_not_found_in_repo', status: 'BLOCKED_MISSING_TARGET' };
  }
  return { operation: 'CREATE_NEW_TARGET_PAGE', intended_winner_path: intendedPath || '', target_route: supportingRoute, renderedPath: supportingRoute.replace(/^\//, '').replace(/\/$/, '/index.html'), supporting_route: '', blocked_reason: '', status: 'READY_TO_RELEASE' };
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
    target_route: record.target_route
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
      if (String(manifest.status) === 'READY_FOR_ABSORPTION') skipped_by_policy.push({ manifest: manifestRel, run_date: manifest.run_date, reason: 'before_exact_implementation_cutover' });
      continue;
    }
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
      records.push({
        id: `agent_${sha(sourceKey, 16)}`,
        source: 'twin_agent_artifact',
        source_run_id: runId,
        source_artifacts: { manifest: manifestRel, csv: manifest.csv_path, html: manifest.html_path },
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
        priority_score: priority,
        source_signal_ids: [`${runId}_${index}`],
        source_records: vertical === 'dentistry' ? ['SRC-ADA-MOUTHHEALTHY'] : [],
        status: decision.status || 'READY_TO_RELEASE'
      });
    });
    if (records.length) {
      const normalizedRel = `${NORMALIZED_ROOT}/${manifest.run_date}_${vertical}.json`;
      writeJson(normalizedRel, { schema_version: '1.1', run_id: runId, manifest: manifestRel, csv_path: manifest.csv_path, html_path: manifest.html_path, record_count: records.length, policy_path: POLICY_PATH, records });
      normalized.push(...records);
      manifest.status = 'ABSORBED';
      manifest.absorbed_at = DATE;
      manifest.normalized_record_count = records.length;
      manifest.normalized_path = normalizedRel;
      manifest.exact_implementation_policy = POLICY_PATH;
      writeJson(manifestRel, manifest);
      absorbed.push({ manifest: manifestRel, run_id: runId, record_count: records.length });
    }
  }
  return { manifests, normalized, invalid, absorbed, skipped_by_policy };
}
function socialFallbackRecords(limit, existingIds) {
  const queue = readJson('data/community/publish_queue.json', []);
  if (!Array.isArray(queue)) return [];
  return queue
    .filter((row) => row && row.query && !existingIds.has(row.id))
    .map((row) => {
      const vertical = normalizeVertical(row.vertical || row.target_vertical || '');
      const query = String(row.query || row.normalized_query || '').trim();
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
        target_route: routeFor(vertical, query),
        source_signal_ids: row.source_signal_ids || [row.id].filter(Boolean),
        source_records: [],
        status: 'READY_TO_RELEASE',
        status_reason: 'fallback_from_social_backlog'
      };
    })
    .filter((row) => row.query.length >= 20 && ['personal_injury', 'dentistry', 'trt', 'neuro', 'uscis-medical'].includes(row.vertical))
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, limit);
}
function updateLedger(agentRecords, plan) {
  const current = readJson(LEDGER_PATH, { schema_version: '1.0', ledger_type: 'cumulative_agent_fix_ledger', fixes: [] });
  const byId = new Map((current.fixes || []).map((fix) => [fix.id, fix]));
  const selected = new Set(plan.selected_ids || []);
  for (const record of agentRecords) {
    const selectedForRelease = selected.has(record.id);
    byId.set(record.id, {
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
      implementation_status: selectedForRelease ? (record.operation || 'SELECTED_FOR_RELEASE') : (String(record.status || '').startsWith('BLOCKED_') ? record.status : 'IMPORTED_NOT_SELECTED'),
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
  const blockedAgent = agent.normalized.filter((r) => String(r.status || '').startsWith('BLOCKED_'));
  const orderedAgent = agent.normalized.filter((r) => r.status === 'READY_TO_RELEASE').sort((a, b) => b.priority_score - a.priority_score);
  for (const record of orderedAgent) {
    if (selected.length >= TARGET) break;
    const routeKey = record.operation === 'REPAIR_INTENDED_WINNER_PAGE' ? `repair:${record.intended_winner_path}` : record.target_route;
    if (seenRoutes.has(routeKey)) continue;
    selected.push(record); seenRoutes.add(routeKey); seenIds.add(record.id);
  }
  const social = socialFallbackRecords(TARGET - selected.length, seenIds);
  for (const record of social) {
    if (selected.length >= TARGET) break;
    if (seenRoutes.has(record.target_route)) continue;
    selected.push(record); seenRoutes.add(record.target_route); seenIds.add(record.id);
  }
  const approvals = selected.map(toApproval);
  writeJson('data/community/approval_queue.json', approvals);
  const plan = {
    schema_version: '1.1',
    status: 'PASS',
    release_date: DATE,
    target_publish_units: TARGET,
    selected_count: selected.length,
    agent_selected_count: selected.filter((r) => r.source === 'twin_agent_artifact').length,
    social_fallback_selected_count: selected.filter((r) => r.source === 'social_public_backlog').length,
    repair_count: selected.filter((r) => r.operation === 'REPAIR_INTENDED_WINNER_PAGE').length,
    new_page_count: selected.filter((r) => r.operation === 'CREATE_NEW_TARGET_PAGE').length,
    blocked_count: blockedAgent.length,
    supporting_page_count: selected.filter((r) => r.supporting_route).length,
    manifests_seen: agent.manifests.length,
    manifests_absorbed: agent.absorbed,
    skipped_by_policy: agent.skipped_by_policy,
    blocked_agent_rows: blockedAgent.map((r) => ({ id: r.id, query: r.query, operation: r.operation, intended_winner_page: r.intended_winner_page, blocked_reason: r.blocked_reason })),
    selected_ids: selected.map((r) => r.id),
    selected_units: selected.map((r) => ({ id: r.id, source: r.source, operation: r.operation || 'CREATE_NEW_TARGET_PAGE', vertical: r.vertical, query: r.query, intended_winner_page: r.intended_winner_page || '', intended_winner_path: r.intended_winner_path || '', target_route: r.target_route, supporting_route: r.supporting_route || '', priority_score: r.priority_score }))
  };
  updateLedger(agent.normalized, plan);
  writeJson('artifacts/validation/velocity-intake-release-plan.json', plan);
  writeText('artifacts/validation/velocity-intake-release-plan.md', [
    '# Velocity Intake Release Plan', '',
    `Status: **${plan.status}**`,
    `Release date: ${DATE}`,
    `Target publish units: ${TARGET}`,
    `Selected units: ${plan.selected_count}`,
    `Twin agent units: ${plan.agent_selected_count}`,
    `Social fallback units: ${plan.social_fallback_selected_count}`,
    `Repair units: ${plan.repair_count}`,
    `New page units: ${plan.new_page_count}`,
    '', '| Source | Operation | Vertical | Target route | Query |', '|---|---|---|---|---|',
    ...plan.selected_units.map((u) => `| ${u.source} | ${u.operation} | ${u.vertical} | ${u.target_route} | ${String(u.query).replace(/\|/g, '\\|')} |`)
  ].join('\n') + '\n');
  writeJson('artifacts/validation/agent-run-intake.json', { schema_version: '1.1', status: 'PASS', manifests_seen: agent.manifests.length, absorbed: agent.absorbed, skipped_by_policy: agent.skipped_by_policy, blocked_count: blockedAgent.length, invalid: [], checked_at: DATE });
  console.log(`VELOCITY INTAKE PREP PASS: ${plan.selected_count} units (${plan.agent_selected_count} agent, ${plan.social_fallback_selected_count} social fallback, ${plan.repair_count} repairs).`);
}

if (require.main === module) main();
