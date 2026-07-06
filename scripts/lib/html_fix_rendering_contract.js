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
  const h = normalizeText(heading);
  if (!h) return 0;
  const sections = raw.match(/<section\b[\s\S]*?<\/section>/gi) || [raw];
  let maxRows = 0;
  for (const section of sections) {
    if (!normalizeText(section).includes(h)) continue;
    const total = (section.match(/<tr\b/gi) || []).length;
    const head = section.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || '';
    const headerRows = (head.match(/<tr\b/gi) || []).length;
    maxRows = Math.max(maxRows, Math.max(0, total - headerRows));
  }
  return maxRows;
}
function forbiddenScaffoldMatches(html) {
  const raw = String(html || '');
  const patterns = [
    /\bUse the source FIX instruction\b/i,
    /\bsource artifact FIX instruction\b/i,
    /\bexact agent FIX instruction\b/i,
    /\brepaired from the exact agent FIX instruction\b/i,
    /\bVerify item \d+ from the source FIX instruction\b/i,
    /\bSource FIX requirement\b/i,
    /\bChoose when this condition matches the user intent\b/i,
    /\binternal FIX instruction\b/i,
    /\bAdd H2\b/i,
    /\bAdd standalone H2\b/i,
    /\badd to (?:the )?cluster question index\b/i,
    /\bUse the exact source artifact recommendation as the implementation authority\b/i,
    /\bPreserve source boundaries and jurisdiction\/provider limitations\b/i
  ];
  return patterns.filter((pattern) => pattern.test(raw)).map((pattern) => `forbidden_scaffold_text:${pattern.source}`);
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
  errors.push(...forbiddenScaffoldMatches(html));
  return errors;
}

module.exports = { normalizeText, includesNormalized, artifactTypesFromHtml, validateEntryAgainstHtml, forbiddenScaffoldMatches };
