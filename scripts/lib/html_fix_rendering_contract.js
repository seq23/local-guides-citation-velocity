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
      // Only a heading the agent NAMED is asserted verbatim. A derived heading is
      // the compiler's own phrasing - a query-derived fallback, or a quoted phrase
      // from an "insert: '...'" edit that is copy rather than a title - and holding
      // the page to it tests the compiler, not the repair. The row's
      // required_strings still carry the substance either way.
      const headingIsAgentNamed = (block.heading_source || 'named') !== 'derived';
      if (block.heading_exact && headingIsAgentNamed && !includesNormalized(html, block.heading_exact)) errors.push(`row:${row.row_id}:missing_heading:${block.heading_exact}`);
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

// countRowsNearHeading is exported so the compiler can ask the SAME question this
// contract will ask, against the same bytes, rather than keeping a second row counter
// that agrees with this one only until one of them is edited.
// IS THIS ENTRY A PROMISE ITS OWN ARTIFACTS CAN KEEP?
//
// Every row requirement names a block by (type, heading_exact) and, for a table,
// by columns_exact. The renderer only ever writes the entry's `artifacts`, so a row
// whose block matches no artifact by type AND heading is unsatisfiable by
// construction - no build, thaw or refreeze can clear it. Likewise a column the
// row demands that its own artifact's headers do not carry.
//
// This is the check validate_agent_exact_acceptance_manifest.js used to keep
// privately as compiledArtifactErrors(). The compiler never asked it, so on
// 2026-09-21 it wrote an entry for insights/personal-injury-q008-* whose rows
// demanded a protocol, a callout and a comparison_table under one heading while
// its artifacts carried only agent_directives under that heading (the carried-entry
// clean had rebuilt all five same-titled artifacts from the FIRST row that shared
// the title), and the release lane went red one validator later on a manifest it
// had just written itself. One function, asked by the compiler before it writes
// (an inconsistent fresh entry is REFUSED by name, not written) and by the validator
// after (a durable entry that has become inconsistent still fails).
function normalizedKey(value) { return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
//
// A block is satisfiable when ANY artifact of its (type, heading) carries every
// column it names. The compiler now merges same-key artifacts on a fresh compile
// (html_fix_acceptance_parser.mergeCollidingArtifact), but four carried entries were
// compiled before that and still hold two same-titled tables with different headers;
// on those pages the row's columns live on the second copy, and the page renders
// both. Keying to the first copy alone called them unsatisfiable when they are not.
function selfConsistencyErrors(entry) {
  const errors = [];
  const artifacts = Array.isArray(entry && entry.artifacts) ? entry.artifacts : [];
  const byKey = new Map();
  for (const artifact of artifacts) {
    if (!artifact) continue;
    const key = `${normalizedKey(artifact.type)}|${normalizedKey(artifact.title)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(artifact);
  }
  for (const row of (entry && entry.row_requirements) || []) {
    for (const block of (row && row.required_blocks) || []) {
      if (!block || !block.heading_exact) continue;
      const candidates = byKey.get(`${normalizedKey(block.type)}|${normalizedKey(block.heading_exact)}`) || [];
      if (!candidates.length) { errors.push(`row:${row.row_id}:compiled_artifact_missing:${block.heading_exact}`); continue; }
      const wanted = (block.columns_exact || []).map((column) => [column, normalizedKey(column)]);
      if (!wanted.length) continue;
      // The candidate that answers the most of this block's columns is the one the
      // block is measured against, so the report names exactly what is missing.
      const best = candidates
        .map((artifact) => {
          const headers = new Set((artifact.headers || []).map(normalizedKey));
          return { lacking: wanted.filter(([, key]) => !headers.has(key)).map(([column]) => column) };
        })
        .sort((a, b) => a.lacking.length - b.lacking.length)[0];
      for (const column of best.lacking) errors.push(`row:${row.row_id}:compiled_artifact_lacks_column:${column}`);
    }
  }
  return errors;
}

module.exports = { normalizeText, includesNormalized, countRowsNearHeading, artifactTypesFromHtml, validateEntryAgainstHtml, forbiddenScaffoldMatches, selfConsistencyErrors };
