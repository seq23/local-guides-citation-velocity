'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { normalizeSeoExecution } = require('./seo_execution_contract');

function normalizeSpace(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function sha(value, len = 16) { return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, len); }
function unique(values) { return [...new Set((values || []).map(normalizeSpace).filter(Boolean))]; }
function slugify(value) { return normalizeSpace(value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 110) || 'citation-question'; }
function normalizeVertical(value) {
  const key = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  const map = { pi:'personal_injury', 'personal injury':'personal_injury', personal_injury:'personal_injury', 'personal-injury':'personal_injury', dentistry:'dentistry', dental:'dentistry', trt:'trt', testosterone:'trt', neuro:'neuro', neuropsych:'neuro', uscis:'uscis-medical', 'uscis medical':'uscis-medical', 'uscis-medical':'uscis-medical', hair:'trt', 'hair-loss':'trt', peptides:'trt' };
  return map[key] || map[key.replace(/-/g, ' ')] || key;
}
function relRoot(root, rel) { return path.join(root, rel); }
function readText(root, rel) { return fs.readFileSync(relRoot(root, rel), 'utf8'); }
function readJson(root, rel, fallback = null) { try { return JSON.parse(readText(root, rel)); } catch { return fallback; } }
function htmlToText(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h2|h3|h4)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .split(/\r?\n/).map(normalizeSpace).filter(Boolean).join('\n');
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (ch === '"') { if (inQuotes && next === '"') { field += '"'; i += 1; } else inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { row.push(field); field = ''; }
    else if ((ch === '\n' || ch === '\r') && !inQuotes) { if (ch === '\r' && next === '\n') i += 1; row.push(field); field = ''; if (row.some((cell) => normalizeSpace(cell))) rows.push(row); row = []; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); if (row.some((cell) => normalizeSpace(cell))) rows.push(row); }
  if (!rows.length) return [];
  const headers = rows.shift().map((h) => String(h || '').replace(/^\uFEFF/, '').trim());
  return rows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, String(cells[i] || '').trim()])));
}
function flattenRecommendation(value) {
  if (!value) return { text: '', fields: {} };
  if (typeof value === 'string') return { text: normalizeSpace(value), fields: { raw: normalizeSpace(value) } };
  if (typeof value === 'object') {
    const fields = {
      edit_instruction: normalizeSpace(value.edit_instruction || value.fix || value.recommendation || value.instruction || ''),
      gap: normalizeSpace(value.gap || value.competitor_gap || ''),
      current_state: normalizeSpace(value.current_state || value.before || ''),
      why_build: normalizeSpace(value.why_build || value.why_worth_building || value.reason || value.why || '')
    };
    const text = unique([fields.edit_instruction, fields.gap, fields.current_state, fields.why_build]).join(' | ');
    return { text, fields };
  }
  return { text: normalizeSpace(String(value)), fields: { raw: normalizeSpace(String(value)) } };
}
// Some report sections carry the answer engine glued onto the end of the query, as
// "how long is the I-693 medical exam valid ... (OpenAI GPT-4o)". That suffix is
// provenance, not part of what a reader ever types. Left attached it became the
// query of record: the page got built, then trace_citation_agent_fixes looked for
// the whole string including "(OpenAI GPT-4o)" in the rendered page, never found it,
// and reported live_missing_query against a page that was in fact correct.
//
// Only a known answer-engine vocabulary is stripped, so a question that legitimately
// ends in parentheses keeps them.
const ENGINE_SUFFIX = /\s*\((?:openai|open ai|gpt[\s-]?[0-9a-z.]*|chatgpt|perplexity|claude|anthropic|gemini|google(?:\s+ai)?(?:\s+overviews?)?|bing|copilot|grok|llama|mistral|deepseek|you\.com|meta\s+ai)[^()]*\)\s*$/i;
function splitEngineSuffix(value) {
  const text = normalizeSpace(value);
  const match = text.match(ENGINE_SUFFIX);
  if (!match) return { query: text, engine: '' };
  return { query: normalizeSpace(text.slice(0, match.index)), engine: normalizeSpace(match[0]).replace(/^\(|\)$/g, '') };
}
function questionFrom(row) {
  const raw = normalizeSpace(row.Query || row.query || row['Target Query'] || row.query_target || row.Question || row['Recommendation Query'] || row.prompt || '');
  const { query } = splitEngineSuffix(raw);
  // Never strip the whole value: a row whose query is nothing but an engine name is
  // malformed, and blanking it would turn a bad row into an invisible one.
  return query || raw;
}
function modelFrom(row) {
  const declared = normalizeSpace(row.Model || row.model || row['AI Model'] || row['Answer Engine'] || row.Engine || '');
  if (declared) return declared;
  const raw = normalizeSpace(row.Query || row.query || row['Target Query'] || row.query_target || row.Question || row['Recommendation Query'] || row.prompt || '');
  const { query, engine } = splitEngineSuffix(raw);
  return query ? engine : '';
}
function targetFrom(row) { return normalizeSpace(row['Repo File Path'] || row.repo_file_path || row['File Path'] || row.file_path || row.intended_winner_path || row['Intended Winner Page'] || row.intended_winner_page || row.url || row.URL || row.page || row['Target URL'] || row.target_url || row.target_page || row.target_filepath || ''); }
function recommendationFrom(row) {
  const flattened = flattenRecommendation(row.fix_recommendation || row['Fix Recommendation'] || row.fix || row.edit_instruction || row.recommendation || row['Recommended Fix'] || row.why_worth_building || row.why_build || row.reason || row.exact_edit || '');
  return flattened;
}
function classifyRecommendationType(row, fallback = 'unknown') {
  const action = normalizeSpace(row.page_decision || row.action_tier || row['Action Tier'] || row.action || '').toLowerCase();
  const gap = normalizeSpace(row.gap_type || row['Gap Type'] || row.gap || '').toLowerCase();
  const target = targetFrom(row);
  if (/page.?fix|fix|repair/.test(action) || /page.?fix|repair|patch/.test(gap) || (target && recommendationFrom(row).text)) return 'existing_page_fix';
  if (/free win|new page|build/.test(action) || /new page|no incumbent|no intended winner/.test(gap) || !target) return 'new_page_opportunity';
  if (/outperform/.test(action)) return 'outperform';
  if (/authority|defend/.test(action)) return 'authority';
  return fallback;
}
function canonicalNewPageKey(record) { return `new_page|${record.vertical}|${slugify(record.query)}`; }
function canonicalPageFixKey(record) { return `page_fix|${record.vertical}|${slugify(record.repo_file_path || record.target_url)}|${slugify(record.query)}`; }
function canonicalDedupeKey(record) { return record.recommendation_type === 'existing_page_fix' ? canonicalPageFixKey(record) : canonicalNewPageKey(record); }
function canonicalSourceRecordId(parts) { return `velocity_src_${sha(parts.join('|'), 18)}`; }
function normalizeSourceRecord({ row, context, sourceFile, sourceSection, index, fallbackType }) {
  const query = questionFrom(row);
  const target = targetFrom(row);
  const recommendation = recommendationFrom(row);
  const type = classifyRecommendationType(row, fallbackType);
  const record = {
    source_record_id: canonicalSourceRecordId([sourceFile, sourceSection, index, query, target, recommendation.text]),
    source_file: sourceFile,
    source_section: sourceSection,
    source_index: index,
    run_date: context.run_date || '',
    vertical: normalizeVertical(context.vertical || row.vertical || row.Vertical || ''),
    query,
    model: modelFrom(row),
    source_grain: modelFrom(row) ? 'QUERY_MODEL_OBSERVATION' : 'QUERY_RECOMMENDATION',
    target_url: /^https?:\/\//i.test(target) ? target : '',
    repo_file_path: !/^https?:\/\//i.test(target) ? target.replace(/^\//, '') : '',
    recommendation_type: type,
    action_tier: normalizeSpace(row.action_tier || row['Action Tier'] || row.action || ''),
    gap_type: normalizeSpace(row.gap_type || row['Gap Type'] || row.gap || ''),
    recommendation_text: recommendation.text,
    recommendation_fields: recommendation.fields,
    status: 'DISCOVERED',
    seo_execution_status: 'NOT_PROVIDED',
    seo_execution: null
  };
  if (sourceSection === 'json.seo_execution') { const normalized = normalizeSeoExecution(row); record.seo_execution_status = normalized.status; record.seo_execution = normalized.value; record.seo_execution_errors = normalized.errors; if (normalized.value) { record.target_url = normalized.value.target_url || record.target_url; record.repo_file_path = normalized.value.target_filepath || record.repo_file_path; record.recommendation_type = normalized.value.page_decision === 'build_new' ? 'new_page_opportunity' : (normalized.value.page_decision === 'repair_existing' ? 'existing_page_fix' : record.recommendation_type); record.recommendation_text = normalized.value.exact_edit || record.recommendation_text; } }
  record.canonical_key = canonicalDedupeKey(record);
  return record;
}
function parseCsvRecords(root, csvPath, context) {
  if (!csvPath || !fs.existsSync(relRoot(root, csvPath))) return [];
  return parseCsv(readText(root, csvPath)).map((row, index) => normalizeSourceRecord({ row, context, sourceFile: csvPath, sourceSection: 'csv', index, fallbackType: '' }))
    .filter((r) => r.query && (r.recommendation_text || r.action_tier || r.repo_file_path || r.target_url));
}
function parseJsonRecords(root, jsonPath, context) {
  if (!jsonPath || !fs.existsSync(relRoot(root, jsonPath))) return [];
  const payload = readJson(root, jsonPath, {});
  const out = [];
  const keys = ['seo_execution','free_wins','outperform','page_fixes','pending','pending_fixes','pages_to_build','new_page_opportunities','recommendations','results','fixes'];
  for (const key of keys) {
    const arr = Array.isArray(payload[key]) ? payload[key] : [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i] || {};
      const fallback = key === 'seo_execution'
        ? (String(item.page_decision || '').includes('build') ? 'new_page_opportunity' : 'existing_page_fix')
        : (['pages_to_build','new_page_opportunities'].includes(key)
          ? 'new_page_opportunity'
          : (['page_fixes','pending_fixes','fixes'].includes(key) ? 'existing_page_fix' : ''));
      const row = { ...item, action_tier: item.action_tier || item.action || (key === 'pages_to_build' ? 'free win' : ''), gap_type: item.gap_type || item.gap || (key === 'pages_to_build' ? 'new page opportunity' : '') };
      const rec = normalizeSourceRecord({ row, context, sourceFile: jsonPath, sourceSection: `json.${key}`, index: i, fallbackType: fallback });
      if (rec.query && (rec.recommendation_text || rec.recommendation_type !== 'unknown' || rec.repo_file_path || rec.target_url)) out.push(rec);
    }
  }
  return out;
}
function parseHtmlRecords(root, htmlPath, context) {
  if (!htmlPath || !fs.existsSync(relRoot(root, htmlPath))) return [];
  const lines = htmlToText(readText(root, htmlPath)).split(/\r?\n/).map(normalizeSpace).filter(Boolean);
  const out = [];
  let section = 'html';
  let current = null;
  function flush() {
    if (!current) return;
    const rec = normalizeSourceRecord({ row: current, context, sourceFile: htmlPath, sourceSection: section, index: out.length, fallbackType: current._fallbackType || '' });
    if (rec.query && (rec.recommendation_text || rec.recommendation_type !== 'unknown')) out.push(rec);
    current = null;
  }
  for (const line of lines) {
    if (/^\d+\.\s*(new page opportunities|pages to build)/i.test(line) || /new page opportunities|pages to build/i.test(line)) { flush(); section = 'html.pages_to_build'; continue; }
    if (/new fixes|page fixes|pending your action/i.test(line)) { flush(); section = /pending/i.test(line) ? 'html.pending' : 'html.page_fixes'; continue; }
    const q = line.match(/QUERY\s*:\s*["“]?(.+?)["”]?$/i) || line.match(/^[-•]?\s*Query\s*:\s*["“]?(.+?)["”]?$/i);
    if (q) { flush(); current = { query: q[1], _fallbackType: section.includes('pages') ? 'new_page_opportunity' : 'existing_page_fix' }; continue; }
    if (!current) continue;
    const src = line.match(/^(?:SOURCE|Discovery Source)\s*:\s*(.+)$/i); if (src) { current.source = src[1]; continue; }
    const why = line.match(/^WHY(?:\s+BUILD|\s+Worth\s+Building)?\s*:\s*(.+)$/i); if (why) { current.why_worth_building = unique([current.why_worth_building, why[1]]).join(' '); current.action_tier = current.action_tier || 'free win'; current.gap_type = current.gap_type || 'new page opportunity'; current._fallbackType = 'new_page_opportunity'; continue; }
    // The HTML report renders this meta line as `FILE: <code>path</code> | LEVEL: L1 |
    // GAP: medium incumbent`. htmlToText flattens it to one line, so a greedy `(.+)$`
    // captured the trailing pipe-delimited metadata as part of the path. Downstream,
    // normalizeImplementationPath then appended `/index.html` to the whole string and the
    // route resolver reported TARGET_NOT_FOUND - which is how a reported 404 on a page
    // that has a perfectly good canonical target went unabsorbed run after run.
    // A repo path never contains a pipe, so the first segment is the path and the rest is
    // `KEY: value` metadata worth keeping rather than discarding.
    const page = line.match(/^(?:PAGE|URL|FILE|TARGET)\s*:\s*(.+)$/i);
    if (page) {
      const [rawPath, ...meta] = String(page[1]).split('|').map((part) => normalizeSpace(part));
      current.repo_file_path = rawPath;
      for (const segment of meta) {
        const kv = segment.match(/^([A-Za-z][A-Za-z _-]*)\s*:\s*(.+)$/);
        if (!kv) continue;
        const key = kv[1].trim().toLowerCase();
        // `GAP: medium incumbent` is the same vocabulary the CSV carries in its
        // `Gap Type` column, so feeding it here gives an HTML-derived row the same
        // gap_type as its CSV twin and lets the two dedupe against each other
        // instead of surviving as near-duplicate records.
        if (key === 'gap') current.gap_type = current.gap_type || kv[2].trim();
      }
      continue;
    }
    const fix = line.match(/^FIX(?:\s+RECOMMENDATION)?\s*:\s*(.+)$/i); if (fix) { current.fix_recommendation = unique([current.fix_recommendation, fix[1]]).join(' '); current._fallbackType = 'existing_page_fix'; continue; }
  }
  flush();
  return out;
}
function duplicateGroups(records) {
  const by = new Map();
  for (const r of records || []) {
    const key = r.canonical_key || canonicalDedupeKey(r);
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(r.source_record_id);
  }
  return [...by.entries()].filter(([, ids]) => ids.length > 1).map(([canonical_key, source_record_ids]) => ({ canonical_key, source_record_ids, source_record_count: source_record_ids.length }));
}
function parseAgentRunBundle({ root, manifest, manifestPath }) {
  const context = { run_date: manifest.run_date || '', vertical: normalizeVertical(manifest.vertical || '') };
  const records = [
    ...parseCsvRecords(root, manifest.csv_path, context),
    ...parseJsonRecords(root, manifest.json_path, context),
    ...parseHtmlRecords(root, manifest.html_path, context)
  ];
  return { manifest_path: manifestPath || '', run_date: context.run_date, vertical: context.vertical, records, errors: [], duplicate_groups: duplicateGroups(records) };
}
function parseManifestBundle({ manifestPath, root }) {
  const manifest = readJson(root, manifestPath, null);
  if (!manifest) return { manifest_path: manifestPath, records: [], errors: [`${manifestPath}:invalid_json`], duplicate_groups: [] };
  return parseAgentRunBundle({ root, manifest, manifestPath });
}
module.exports = { parseAgentRunBundle, parseManifestBundle, parseCsvRecords, parseJsonRecords, parseHtmlRecords, flattenRecommendation, normalizeSourceRecord, canonicalSourceRecordId, canonicalDedupeKey, canonicalNewPageKey, canonicalPageFixKey, classifyRecommendationType, duplicateGroups, normalizeSpace, questionFrom, modelFrom, splitEngineSuffix, slugify };
