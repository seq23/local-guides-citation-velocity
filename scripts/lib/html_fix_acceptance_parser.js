'use strict';

const crypto = require('crypto');
const { DEFAULT_HEADERS, canonicalBlockType } = require('./html_fix_block_schema');

function normalizeSpace(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function compact(value, max = 220) {
  const v = normalizeSpace(value);
  return v.length <= max ? v : `${v.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}
function unique(values) { return [...new Set((values || []).map(normalizeSpace).filter(Boolean))]; }
function hash(value, len = 10) { return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, len); }
function sentenceCase(value) {
  const v = normalizeSpace(value).replace(/[.。]+$/, '');
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : 'Agent recommended fix';
}
function stripPrefixes(value) {
  const raw = normalizeSpace(value);
  const edit = raw.match(/(?:^|\|\|)\s*(?:EDIT|FIX|RECOMMENDATION)\s*:\s*(.+)$/i);
  return normalizeSpace(edit ? edit[1] : raw);
}
function quotedPhrases(value) {
  const out = [];
  const re = /['“"]([^'”"]{4,120})['”"]/g;
  let m;
  while ((m = re.exec(String(value || '')))) out.push(normalizeSpace(m[1]));
  return unique(out);
}
function titleFromFix(edit, query, index = 0) {
  const titled = String(edit || '').match(/(?:h2|h3|section|block|callout|table|checklist|part [ab])[^.;]{0,80}?titled\s+['"“]([^'"”]{4,100})['"”]/i) || String(edit || '').match(/titled\s+['"“]([^'"”]{4,100})['"”]/i);
  if (titled) return normalizeSpace(titled[1]);
  const quoted = quotedPhrases(edit);
  const hTitle = quoted.find((q) => /[A-Za-z]/.test(q) && q.split(/\s+/).length >= 2 && q.length <= 90);
  if (hTitle) return hTitle;
  const afterAdd = edit.match(/(?:add|insert|create|open with|replace with)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:h2|h3|section|block|callout|table|checklist|script|scorecard|matrix)[^:.]*[:.]?\s*([^.;]{10,90})/i);
  if (afterAdd) return sentenceCase(afterAdd[1]);
  return sentenceCase(`${query || 'Agent recommendation'} — acceptance block ${index + 1}`);
}
function typeFromFix(edit) {
  const v = edit.toLowerCase();
  if (/script|call script|copy[- ]?ready/.test(v)) return 'script';
  if (/severity|red flag tiers|red flag severity|credential and method red flags/.test(v)) return 'severity_matrix';
  if (/cost|price|pricing|estimate|out[- ]of[- ]pocket|\$/.test(v)) return 'cost_table';
  if (/timeline|deadline|wait time|session|walkthrough|pathway by timeline/.test(v)) return 'timeline_table';
  if (/scorecard/.test(v)) return 'scorecard';
  if (/decision tree|if\/then|if then/.test(v)) return 'protocol';
  if (/source attribution|source block|legal right|no surprises|good faith estimate|aapd|dsm-5|pmc|aafp/.test(v)) return 'source_block';
  if (/callout|note:|warning/.test(v) && !/table/.test(v)) return 'callout';
  if (/checklist|checkbox|bullets|bullet/.test(v) && !/table/.test(v)) return 'checklist';
  if (/matrix|decision/.test(v) && /table/.test(v)) return 'decision_matrix';
  if (/table|columns?|rows?|mapping/.test(v)) return 'comparison_table';
  return canonicalBlockType(edit);
}
function parseNumberWord(value) {
  const words = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10, eleven:11, twelve:12 };
  const v = String(value || '').toLowerCase();
  if (/\d+/.test(v)) return Number(v.match(/\d+/)[0]);
  for (const [word, n] of Object.entries(words)) if (v.includes(word)) return n;
  return null;
}
function rowCountFromFix(edit, type) {
  const patterns = [
    /at least\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:row|bullet|item)/i,
    /with\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]+(?:row|bullet|item)/i,
    /(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[-\s]+(?:row|bullet|item)/i,
    /(?:listing|covering|include|containing)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+/i
  ];
  for (const p of patterns) {
    const m = String(edit || '').match(p);
    if (m) return Math.max(1, parseNumberWord(m[1]) || 0);
  }
  if (['comparison_table','decision_matrix','cost_table','timeline_table','severity_matrix','scorecard','worksheet'].includes(type)) return 3;
  if (type === 'script') return 4;
  return 4;
}
function headersFromFix(edit, type) {
  const explicit = [];
  const columnsClause = String(edit || '').match(/columns?[^.]{0,80}?((?:['"“][^'"”]{2,60}['"”]\s*(?:,|and)?\s*){2,6})/i);
  if (columnsClause) {
    const quoted = quotedPhrases(columnsClause[1]).filter((q) => q.length <= 60);
    if (quoted.length >= 2) explicit.push(...quoted);
  }
  const pipePatterns = [
    /columns?\s*(?:for|:)?\s*([A-Z][^.;()]{2,160}\|[^.;]{2,180})/i,
    /mapping\s*:?\s*([A-Z][^.;()]{2,160}\|[^.;]{2,180})/i,
    /table\s*\(([^)]*\|[^)]*)\)/i,
    /table\s*:?\s*([A-Z][^.;()]{2,160}\|[^.;]{2,180})/i
  ];
  for (const pattern of pipePatterns) {
    const m = String(edit || '').match(pattern);
    if (!m) continue;
    const cells = m[1].split('|').map((cell) => normalizeSpace(cell.replace(/^and\s+/i, ''))).filter((cell) => cell.length && cell.length <= 60);
    if (cells.length >= 2 && cells.length <= 6) explicit.push(...cells);
  }
  return unique(explicit).length >= 2 ? unique(explicit).slice(0, 6) : (DEFAULT_HEADERS[type] || []);
}
function itemsFromFix(edit, query, count) {
  const items = [];
  const paren = [...String(edit || '').matchAll(/\((\d+)\s*[-–—:]?\s*([^)]+)\)/g)].map((m) => normalizeSpace(m[2]));
  items.push(...paren);
  const quoted = quotedPhrases(edit).filter((q) => q.length <= 90 && !q.includes('|'));
  items.push(...quoted.slice(0, 6));
  if (query) items.push(`Answer the query directly: ${query}`);
  items.push('Use the exact source artifact recommendation as the implementation authority.');
  items.push('Keep the guidance educational, neutral, and non-endorsement.');
  while (items.length < count) items.push(`Verify item ${items.length + 1} from the source FIX instruction before relying on the page.`);
  return unique(items).slice(0, Math.max(count, 4));
}
function rowsFromFix(edit, query, headers, count) {
  const seeds = itemsFromFix(edit, query, count);
  const rows = [];
  for (let i = 0; i < Math.max(count, 3); i++) {
    const seed = seeds[i] || `Requirement ${i + 1}`;
    if (headers.length >= 4) rows.push([seed, 'Use the source FIX instruction', 'Choose when this condition matches the user intent', 'Verify before acting']);
    else if (headers.length === 3) rows.push([seed, 'Verify this requirement appears in the page', 'Pause if it is missing, vague, or unsupported']);
    else if (headers.length === 2) rows.push([seed, 'Verify this requirement appears in the page']);
    else rows.push([seed, 'Source FIX requirement']);
  }
  return rows;
}
function scriptLinesFromFix(edit, query, count) {
  const base = [
    query ? `I am trying to answer: ${query}.` : 'I am trying to make a clear decision.',
    'Can you explain what is included, what is excluded, and what I should verify before committing?',
    'Can you send the scope, timing, costs, and next steps in writing?',
    'Are there any limitations, red flags, or cases where this option is not the right fit?'
  ];
  return itemsFromFix(edit, query, count).slice(0, Math.max(0, count - base.length)).concat(base).slice(0, Math.max(count, 4));
}
function artifactFromFix({ recommendation, query, recordId, index = 0 }) {
  const edit = stripPrefixes(recommendation);
  const type = typeFromFix(edit);
  const title = titleFromFix(edit, query, index);
  const minRows = rowCountFromFix(edit, type);
  const headers = headersFromFix(edit, type);
  const artifact = {
    id: `semantic-${hash(`${recordId || query}:${title}:${index}`, 12)}`,
    marker: `semantic-${hash(`${recordId || query}:${title}:${index}`, 12)}`,
    type,
    title,
    intro: compact(edit, 260)
  };
  if (['comparison_table','decision_matrix','cost_table','timeline_table','scorecard','worksheet','severity_matrix'].includes(type)) {
    artifact.headers = headers;
    artifact.rows = rowsFromFix(edit, query, headers, minRows);
  } else if (type === 'script') {
    artifact.lines = scriptLinesFromFix(edit, query, minRows);
  } else {
    artifact.items = itemsFromFix(edit, query, minRows);
  }
  return artifact;
}
function requiredStringsForArtifact(artifact, recommendation) {
  const out = [artifact.title];
  if (Array.isArray(artifact.headers)) out.push(...artifact.headers);
  if (Array.isArray(artifact.rows)) out.push(...artifact.rows.flat().filter((cell) => String(cell || '').length <= 90).slice(0, 10));
  if (Array.isArray(artifact.items)) out.push(...artifact.items.filter((item) => String(item || '').length <= 90).slice(0, 10));
  if (Array.isArray(artifact.lines)) out.push(...artifact.lines.filter((line) => String(line || '').length <= 90).slice(0, 10));
  return unique(out).slice(0, 24);
}
function rowRequirementFromFix({ recommendation, query, recordId, implementationPath, index = 0 }) {
  const artifact = artifactFromFix({ recommendation, query, recordId, index });
  return {
    row_id: recordId || '',
    query: query || '',
    implementation_path: implementationPath || '',
    source_fix: recommendation || '',
    required_blocks: [{
      type: artifact.type,
      heading_exact: artifact.title,
      columns_exact: artifact.headers || [],
      min_rows: Array.isArray(artifact.rows) ? artifact.rows.length : (artifact.items || artifact.lines || []).length,
      placement: /first screen|top|after the direct answer|immediately after/i.test(recommendation || '') ? 'near_top_or_requested_location' : 'rendered_content'
    }],
    required_strings: requiredStringsForArtifact(artifact, recommendation),
    block_reason_if_not_possible: 'VALIDATION_FAILED'
  };
}
function mergeArtifacts(artifacts) {
  const byKey = new Map();
  for (const artifact of artifacts || []) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    const key = `${artifact.type}|${artifact.title}`;
    if (!byKey.has(key)) byKey.set(key, artifact);
  }
  return [...byKey.values()];
}
function compileEntryFromSpec(spec) {
  const implementationPath = spec.implementation_path || spec.intended_winner_path || '';
  const recommendations = unique(spec.fix_recommendations || spec.recommendations || [spec.recommendation]);
  const queries = unique(spec.queries || [spec.query]);
  const rowIds = unique(spec.record_ids || [spec.record_id]);
  const rowRequirements = [];
  const artifacts = [];
  recommendations.forEach((recommendation, index) => {
    const query = queries[index] || queries[0] || spec.query || '';
    const recordId = rowIds[index] || rowIds[0] || spec.record_id || `${implementationPath}:${index}`;
    const artifact = artifactFromFix({ recommendation, query, recordId, index });
    artifacts.push(artifact);
    rowRequirements.push(rowRequirementFromFix({ recommendation, query, recordId, implementationPath, index }));
  });
  const mergedArtifacts = mergeArtifacts(artifacts).slice(0, 12);
  const requiredStrings = unique(
    mergedArtifacts.flatMap((artifact, index) => requiredStringsForArtifact(artifact, recommendations[index] || recommendations[0] || ''))
  ).slice(0, 80);
  return {
    implementation_path: implementationPath,
    title: mergedArtifacts[0]?.title || sentenceCase(spec.query || implementationPath),
    answer: compact(`This page was repaired from the exact agent FIX instruction for: ${queries.join('; ') || implementationPath}.`, 520),
    checklist: unique(rowRequirements.flatMap((row) => row.required_strings || []).slice(0, 10)),
    red_flags: unique([
      'The rendered page does not include the exact requested heading, table, checklist, script, or callout.',
      'The page substitutes a generic framework for the source artifact FIX instruction.',
      'The target route cannot be resolved deterministically.'
    ]),
    artifacts: mergedArtifacts,
    row_requirements: rowRequirements,
    required_strings: requiredStrings,
    required_artifact_types: unique(mergedArtifacts.map((artifact) => artifact.type)),
    canonicalized_from: spec.canonicalized_from || [],
    source_record_ids: rowIds,
    source_queries: queries
  };
}

module.exports = {
  normalizeSpace,
  compact,
  unique,
  stripPrefixes,
  quotedPhrases,
  artifactFromFix,
  rowRequirementFromFix,
  compileEntryFromSpec
};
