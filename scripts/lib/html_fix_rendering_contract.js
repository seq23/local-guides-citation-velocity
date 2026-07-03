'use strict';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[^a-z0-9$+%/.'-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function includesNormalized(haystack, needle) {
  const n = normalizeText(needle);
  return !n || normalizeText(haystack).includes(n);
}
function artifactTypesFromHtml(html) {
  const out = new Set();
  const re = /data-citation-velocity-artifact="([^"]+)"/g;
  let match;
  while ((match = re.exec(String(html || '')))) out.add(match[1]);
  return out;
}
function countRowsNearHeading(html, heading) {
  const raw = String(html || '');
  const lower = raw.toLowerCase();
  const h = String(heading || '').toLowerCase();
  const idx = h ? lower.indexOf(h.replace(/&/g, '&amp;')) >= 0 ? lower.indexOf(h.replace(/&/g, '&amp;')) : lower.indexOf(h) : -1;
  if (idx < 0) return 0;
  const after = raw.slice(idx);
  const end = after.search(/<\/section>/i);
  const section = end >= 0 ? after.slice(0, end) : after.slice(0, 12000);
  return Math.max(0, (section.match(/<tr\b/gi) || []).length - (section.match(/<thead[\s\S]*?<\/thead>/i)?.[0]?.match(/<tr\b/gi) || []).length);
}
function validateEntryAgainstHtml(entry, html) {
  const errors = [];
  const types = artifactTypesFromHtml(html);
  for (const type of entry.required_artifact_types || []) if (!types.has(type)) errors.push(`missing_artifact_type:${type}`);
  for (const needle of entry.required_strings || []) if (!includesNormalized(html, needle)) errors.push(`missing_required_string:${needle}`);
  for (const row of entry.row_requirements || []) {
    for (const block of row.required_blocks || []) {
      if (block.heading_exact && !includesNormalized(html, block.heading_exact)) errors.push(`row:${row.row_id}:missing_heading:${block.heading_exact}`);
      for (const column of block.columns_exact || []) if (!includesNormalized(html, column)) errors.push(`row:${row.row_id}:missing_column:${column}`);
      if (block.min_rows && ['comparison_table','decision_matrix','cost_table','timeline_table','severity_matrix','scorecard','worksheet'].includes(block.type)) {
        const rows = countRowsNearHeading(html, block.heading_exact || '');
        if (rows && rows < Number(block.min_rows)) errors.push(`row:${row.row_id}:min_rows_not_met:${rows}<${block.min_rows}`);
      }
    }
  }
  if (String(html || '').includes('Agent Exact Repair Framework:')) errors.push('generic_agent_exact_framework_still_rendered');
  return errors;
}

module.exports = { normalizeText, includesNormalized, artifactTypesFromHtml, validateEntryAgainstHtml };
