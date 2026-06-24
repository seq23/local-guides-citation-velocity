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
  return row.Query || row.query || row['Target Query'] || row['query_target'] || row['Question'] || row['Recommendation Query'] || '';
}
function desiredPageFromRow(row) {
  return row['Intended Winner Page'] || row.url || row.URL || row.page || row['Target URL'] || row.target_page || '';
}
function rowNeedsPatch(row) {
  const action = String(row['Action Tier'] || row.action_tier || '').toLowerCase();
  if (action && !action.includes('none')) return true;
  if (boolish(row['Patch Needed (Y/N)'] || row.patch_needed)) return true;
  if (boolish(row['Gap Found'] || row.gap_found)) return true;
  return false;
}
function fixType(row) {
  return String(row['Primary Fix Type'] || row['Gap Type'] || row.fix_type || 'citation_gap').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'citation_gap';
}
function routeFor(vertical, question) {
  return `/${String(vertical).replace(/_/g, '-')}/community-questions/${slugify(question)}/`;
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
    fix_type: record.fix_type,
    action_tier: record.action_tier,
    priority_score: record.priority_score,
    source_records: record.source_records,
    source_signal_ids: record.source_signal_ids,
    citation_velocity: true,
    recommended_action: record.recommendation,
    status_reason: record.status_reason || 'selected_for_velocity_intake_release'
  };
}
function importAgentRuns() {
  const manifests = walkManifests();
  const normalized = [];
  const invalid = [];
  const absorbed = [];
  for (const manifestRel of manifests) {
    let manifest;
    try { manifest = readJson(manifestRel); } catch (err) { invalid.push({ manifest: manifestRel, error: `invalid_json:${err.message}` }); continue; }
    const errors = artifactErrors(manifest, manifestRel);
    if (errors.length) { invalid.push({ manifest: manifestRel, errors }); continue; }
    if (String(manifest.status) !== 'READY_FOR_ABSORPTION') continue;
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
      records.push({
        id: `agent_${sha(sourceKey, 16)}`,
        source: 'twin_agent_artifact',
        source_run_id: runId,
        source_artifacts: { manifest: manifestRel, csv: manifest.csv_path, html: manifest.html_path },
        run_date: manifest.run_date,
        vertical,
        query,
        intended_winner_page: desired,
        cited_sources: row['Cited Sources'] || '',
        answer_shape: row['Answer Shape'] || '',
        gap_type: row['Gap Type'] || '',
        fix_type: fixType(row),
        action_tier: row['Action Tier'] || '',
        recommendation: row['Fix Recommendation'] || '',
        priority_score: priority,
        target_route: routeFor(vertical, query),
        source_signal_ids: [`${runId}_${index}`],
        source_records: vertical === 'dentistry' ? ['SRC-ADA-MOUTHHEALTHY'] : [],
        status: 'READY_TO_RELEASE'
      });
    });
    if (records.length) {
      const normalizedRel = `${NORMALIZED_ROOT}/${manifest.run_date}_${vertical}.json`;
      writeJson(normalizedRel, { schema_version: '1.0', run_id: runId, manifest: manifestRel, csv_path: manifest.csv_path, html_path: manifest.html_path, record_count: records.length, records });
      normalized.push(...records);
      manifest.status = 'ABSORBED';
      manifest.absorbed_at = DATE;
      manifest.normalized_record_count = records.length;
      manifest.normalized_path = normalizedRel;
      writeJson(manifestRel, manifest);
      absorbed.push({ manifest: manifestRel, run_id: runId, record_count: records.length });
    }
  }
  return { manifests, normalized, invalid, absorbed };
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
  for (const record of agentRecords) {
    byId.set(record.id, {
      id: record.id,
      run_date: record.run_date,
      vertical: record.vertical,
      query: record.query,
      intended_winner_page: record.intended_winner_page,
      target_route: record.target_route,
      fix_type: record.fix_type,
      action_tier: record.action_tier,
      source_artifacts: record.source_artifacts,
      implementation_status: plan.selected_ids.includes(record.id) ? 'SELECTED_FOR_RELEASE' : 'IMPORTED_NOT_SELECTED',
      trace_required: plan.selected_ids.includes(record.id),
      sourceFiles: ['content/_staged/pages.json', 'content/_live/pages.json'],
      liveManifestPath: 'content/_live/pages.json',
      stagedManifestPath: 'content/_staged/pages.json',
      renderedPath: record.target_route.replace(/^\//, '').replace(/\/$/, '/index.html'),
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
  const orderedAgent = agent.normalized.sort((a, b) => b.priority_score - a.priority_score);
  for (const record of orderedAgent) {
    if (selected.length >= TARGET) break;
    if (seenRoutes.has(record.target_route)) continue;
    selected.push(record); seenRoutes.add(record.target_route); seenIds.add(record.id);
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
    schema_version: '1.0',
    status: 'PASS',
    release_date: DATE,
    target_publish_units: TARGET,
    selected_count: selected.length,
    agent_selected_count: selected.filter((r) => r.source === 'twin_agent_artifact').length,
    social_fallback_selected_count: selected.filter((r) => r.source === 'social_public_backlog').length,
    manifests_seen: agent.manifests.length,
    manifests_absorbed: agent.absorbed,
    selected_ids: selected.map((r) => r.id),
    selected_units: selected.map((r) => ({ id: r.id, source: r.source, vertical: r.vertical, query: r.query, target_route: r.target_route, priority_score: r.priority_score }))
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
    '', '| Source | Vertical | Target route | Query |', '|---|---|---|---|',
    ...plan.selected_units.map((u) => `| ${u.source} | ${u.vertical} | ${u.target_route} | ${String(u.query).replace(/\|/g, '\\|')} |`)
  ].join('\n') + '\n');
  writeJson('artifacts/validation/agent-run-intake.json', { schema_version: '1.0', status: 'PASS', manifests_seen: agent.manifests.length, absorbed: agent.absorbed, invalid: [], checked_at: DATE });
  console.log(`VELOCITY INTAKE PREP PASS: ${plan.selected_count} units (${plan.agent_selected_count} agent, ${plan.social_fallback_selected_count} social fallback).`);
}

if (require.main === module) main();
