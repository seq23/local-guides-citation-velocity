'use strict';

const crypto = require('crypto');
const { DEFAULT_HEADERS, canonicalBlockType } = require('./html_fix_block_schema');
const { isInternalInstructionText, containsInternalInstruction, readerFacingQueryPrompt } = require('./internal_instruction_text');

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
// An agent quotes two different kinds of thing: copy it wants on the page, and copy
// it found on the page and is complaining about. Only the first is usable. A quoted
// phrase that is itself an internal build directive is always the second kind, so it
// is dropped here rather than at each of the six call sites downstream.
function quotedPhrases(value) {
  const out = [];
  const re = /['“"]([^'”"]{4,120})['”"]/g;
  let m;
  while ((m = re.exec(String(value || '')))) out.push(normalizeSpace(m[1]));
  return unique(out).filter((phrase) => !isInternalInstructionText(phrase));
}
function isWorkflowInstruction(value) {
  const v = normalizeSpace(value).toLowerCase();
  if (!v) return true;
  return (
    /\badd\s+(?:a\s+|an\s+|standalone\s+)?h[23]\b/.test(v) ||
    /^and\s+h[23]\b/.test(v) ||
    /^as\s+parallel\b/.test(v) ||
    /^then\s+add\b/.test(v) ||
    /^add\s+(?:a\s+|an\s+|the\s+)?(?:section|block|table|checklist|callout|faq schema|internal link)\b/.test(v) ||
    /^add to (?:the )?cluster question index\b/.test(v) ||
    /^position(?:ed)?\b/.test(v) ||
    /^place\b/.test(v) ||
    /^cross-?link\b/.test(v) ||
    /^internal link\b/.test(v) ||
    /^replace\b/.test(v) ||
    /^insert\b/.test(v) ||
    /^keep\b/.test(v) ||
    /^format as\b/.test(v) ||
    /^close with\b/.test(v) ||
    /^reference\b/.test(v) ||
    /^note state-by-state\b/.test(v) ||
    /^include\s+(?:a|an|the|two-part|three-row|numbered|parallel|proceed\/pause|post-accident)\b/.test(v) ||
    /^use the exact source artifact recommendation\b/.test(v) ||
    /^preserve source boundaries\b/.test(v)
  );
}
function readerIntroForArtifact(title, query, type) {
  const subject = normalizeSpace(query || title || 'this decision');
  if (type === 'cost_table') return `Use this table to decide what to verify before acting on ${subject}.`;
  if (type === 'comparison_table' || type === 'decision_matrix') return `Compare each option against the same concrete criteria before acting on ${subject}.`;
  if (type === 'agent_directive') return `Use this section to answer ${subject} with concrete checks, evidence, and limits.`;
  return `Use this section to turn ${subject} into a concrete next step.`;
}

function extractInstructionRequirements(edit) {
  const raw = String(edit || '');
  return unique([
    ...quotedPhrases(raw),
    ...(raw.match(/add\s+[^.;]+/gi) || []),
    ...(raw.match(/include\s+[^.;]+/gi) || []),
    ...(raw.match(/compare\s+[^.;]+/gi) || []),
    ...(raw.match(/explain\s+[^.;]+/gi) || []),
    ...(raw.match(/define\s+[^.;]+/gi) || [])
  ]).filter(usableAsCopy).slice(0, 12);
}

// A title becomes an <h2> on a public page and a required_string the trace then
// enforces, so every candidate has to clear both filters: workflow imperatives
// ("add an h2...") and internal build directives. The final fallback is derived from
// the query, so refusing a candidate degrades to a readable heading, never to none.
function usableAsCopy(value) {
  return Boolean(normalizeSpace(value)) && !isWorkflowInstruction(value) && !isInternalInstructionText(value);
}
// Fallback heading, used when the EDIT text names no title of its own.
//
// It used to be `<query> — acceptance block N`: the compiler naming its own
// output. That name went out as a visible <h2>, as the schema.org HowTo `name`,
// and as a required_string on 20 pages, so a reader who asked "how much does TRT
// cost" met a heading about the build system's blocks. Name the block by what it
// does for the reader instead - the same move readerIntroForArtifact already
// makes one line further on - and the heading stops being internal vocabulary.
//
// Keyed by the same block types typeFromFix returns, so a new type gets a real
// heading by adding one line here rather than by falling back to a generic one.
const FALLBACK_TITLE_BY_TYPE = {
  cost_table: 'what it costs and what to check',
  comparison_table: 'how to compare your options',
  decision_matrix: 'how to compare your options',
  timeline_table: 'what happens, and when',
  severity_matrix: 'how urgent it is, and what to do',
  scorecard: 'how to score each option',
  worksheet: 'work it through',
  script: 'what to ask, word for word',
  checklist: 'what to check before you act',
  callout: 'what to know before you act',
  protocol: 'how to decide, step by step',
  source_block: 'which sources to verify',
  agent_directive: 'what to verify before you act'
};
// `fallbackSeq` is a per-page Map the caller owns. Several recommendations for one
// page can all fall back to the same heading, and two identical <h2>s are worse for
// a reader than a numbered pair. Numbering off the recommendation index instead
// produced "(9)", "(13)", "(22)" - a counter of something the reader cannot see,
// which is the same mistake as the name it replaced. This counts only the headings
// that actually collide, so the first is unnumbered and the rest run 2, 3, 4.
function fallbackTitle(query, type, fallbackSeq) {
  const subject = sentenceCase(query || 'This decision');
  const suffix = FALLBACK_TITLE_BY_TYPE[type] || FALLBACK_TITLE_BY_TYPE.agent_directive;
  const base = `${subject} — ${suffix}`;
  if (!fallbackSeq) return base;
  const n = (fallbackSeq.get(base) || 0) + 1;
  fallbackSeq.set(base, n);
  return n > 1 ? `${base} (${n})` : base;
}
function titleFromFix(edit, query, index = 0, type = 'agent_directive', fallbackSeq = null) {
  const titled = String(edit || '').match(/(?:h2|h3|section|block|callout|table|checklist|part [ab])[^.;]{0,80}?titled\s+['"“]([^'"”]{4,100})['"”]/i) || String(edit || '').match(/titled\s+['"“]([^'"”]{4,100})['"”]/i);
  if (titled && usableAsCopy(titled[1])) return normalizeSpace(titled[1]);
  const quoted = quotedPhrases(edit).filter(usableAsCopy);
  const hTitle = quoted.find((q) => /[A-Za-z]/.test(q) && q.split(/\s+/).length >= 2 && q.length <= 90);
  if (hTitle) return hTitle;
  const h2On = String(edit || '').match(/\badd\s+(?:a\s+|an\s+)?h[23]\s+section\s+on\s+([^.;]{8,90})/i);
  if (h2On && usableAsCopy(h2On[1])) return sentenceCase(h2On[1]);
  const afterAdd = edit.match(/(?:add|insert|create|open with|replace with)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:h2|h3|section|block|callout|table|checklist|script|scorecard|matrix)[^:.]*[:.]?\s*([^.;]{10,90})/i);
  if (afterAdd && usableAsCopy(afterAdd[1])) return sentenceCase(afterAdd[1]);
  return fallbackTitle(query, type, fallbackSeq);
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
  const canonical = canonicalBlockType(edit);
  return canonical && canonical !== 'checklist' ? canonical : 'agent_directive';
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
    const cells = m[1].split('|')
      .map((cell) => normalizeSpace(cell.replace(/^and\s+/i, '').replace(/^.*\bmapping\s*:\s*/i, '').replace(/^.*\bcolumns?\s*:\s*/i, '')))
      .filter((cell) => cell.length && cell.length <= 60);
    if (cells.length >= 2 && cells.length <= 6) explicit.push(...cells);
  }
  return unique(explicit).length >= 2 ? unique(explicit).slice(0, 6) : (DEFAULT_HEADERS[type] || []);
}
function requirementsFromFix(edit, query, count) {
  const text = normalizeSpace(edit);
  const out = [];
  const quoted = quotedPhrases(text).filter((q) => q.length <= 90 && !q.includes('|') && !isWorkflowInstruction(q));
  out.push(...quoted);
  const colonList = text.match(/covering\s*:\s*([^.;]+)/i) || text.match(/covering\s+([^.;]+)/i);
  if (colonList) out.push(...colonList[1].split(/,|;|\band\b/i).map(sentenceCase));
  if (/accident attorneys?|personal injury lawyers?|injury lawyer|slogans/i.test(`${query} ${text}`)) {
    out.push(
      'Accident type fit',
      'Plaintiff-side injury focus',
      'Fee and cost clarity',
      'Case staffing and communication',
      'Trial readiness and pressure tactics',
      'Written next steps'
    );
  }
  if (/comparison|compare|shortlist/i.test(`${query} ${text}`)) {
    out.push('Compare every option with the same criteria', 'Ask for specifics instead of accepting ranking language');
  }
  // Was `Directly answer: ${query}` - an instruction to the generator, published
  // as reader copy on 133 pages. Ask the question instead; same intent, right audience.
  if (query) out.push(readerFacingQueryPrompt(query));
  while (out.length < count) out.push(`Concrete verification point ${out.length + 1}`);
  return unique(out).slice(0, Math.max(count, 4));
}
function itemsFromFix(edit, query, count) {
  const paren = [...String(edit || '').matchAll(/\((\d+)\s*[-–—:]?\s*([^)]+)\)/g)].map((m) => normalizeSpace(m[2])).filter((item) => !isWorkflowInstruction(item));
  return unique([...paren, ...requirementsFromFix(edit, query, count)]).filter((item) => !isWorkflowInstruction(item)).slice(0, Math.max(count, 4));
}
function tableRowForRequirement(requirement, query, index) {
  const r = normalizeSpace(requirement);
  if (/accident type fit/i.test(r)) return ['Accident type fit', 'Ask whether the attorney routinely handles your exact accident type, not just personal injury generally.', 'Car, truck, workplace, slip-and-fall, rideshare, and hit-and-run claims have different evidence, insurance, and deadline issues.'];
  if (/plaintiff-side/i.test(r)) return ['Plaintiff-side injury focus', 'Confirm the lawyer represents injured people and can explain the claim from the victim side.', 'A general litigator or defense-heavy practice may not be built for settlement pressure, medical proof, and insurer negotiation.'];
  if (/fee|cost/i.test(r)) return ['Fee and cost clarity', 'Get the contingency percentage, case-cost handling, and any trial-stage fee changes in writing.', 'Slogan-heavy firms often hide the real economic terms until after intake.'];
  if (/staffing|communication/i.test(r)) return ['Case staffing and communication', 'Ask who handles the file day to day and how often you will receive updates.', 'The lawyer on the ad may not be the person managing evidence, treatment records, negotiations, or settlement decisions.'];
  if (/trial readiness|pressure/i.test(r)) return ['Trial readiness and pressure tactics', 'Ask what happens if the insurer will not make a fair offer, and pause if the firm pressures you to sign immediately.', 'Real leverage comes from preparation and clear options, not urgency language or “best lawyer” claims.'];
  if (/written next steps/i.test(r)) return ['Written next steps', 'Ask for the next three steps, expected documents, and near-term timeline before signing.', 'A clear written process is easier to compare than reviews, awards, badges, or vague promises.'];
  if (/same criteria|specifics/i.test(r)) return ['Comparison method', 'Use the same verification questions with every option you compare.', 'A consistent comparison makes differences in scope, evidence, timing, cost, and next steps easier to verify.'];
  return [
    r || `Requirement ${index + 1}`,
    query ? `Translate “${query}” into a specific verification question before choosing a provider.` : 'Turn the recommendation into a concrete verification question.',
    'Specific, written answers are more reliable than broad marketing claims.'
  ];
}
function rowsFromFix(edit, query, headers, count) {
  const seeds = itemsFromFix(edit, query, count);
  const rows = [];
  for (let i = 0; i < Math.max(count, 3); i++) {
    const base = tableRowForRequirement(seeds[i] || `Requirement ${i + 1}`, query, i);
    if (headers.length >= 4) rows.push([...base, 'Ask for this in plain English before signing.'].slice(0, headers.length));
    else if (headers.length === 3) rows.push(base);
    else if (headers.length === 2) rows.push([base[0], base[1]]);
    else rows.push([base[0], base[1]]);
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
function artifactFromFix({ recommendation, query, recordId, index = 0, fallbackSeq = null }) {
  const edit = stripPrefixes(recommendation);
  const type = typeFromFix(edit);
  const title = titleFromFix(edit, query, index, type, fallbackSeq);
  const minRows = rowCountFromFix(edit, type);
  const headers = headersFromFix(edit, type);
  const artifact = {
    id: `semantic-${hash(`${recordId || query}:${title}:${index}`, 12)}`,
    marker: `semantic-${hash(`${recordId || query}:${title}:${index}`, 12)}`,
    type,
    title,
    intro: readerIntroForArtifact(title, query, type)
  };
  if (type === 'agent_directive') {
    artifact.source_instruction = edit;
    artifact.query_target = query || '';
    artifact.extracted_requirements = extractInstructionRequirements(edit);
    artifact.items = unique([
      ...artifact.extracted_requirements,
      // Was `Answer directly: ${query}` - see readerFacingQueryPrompt.
      query ? readerFacingQueryPrompt(query) : '',
      'Verify the evidence before treating the answer as settled.',
      'Flag any jurisdiction, provider, or policy limits that could change the answer.'
    ]).filter(usableAsCopy).slice(0, Math.max(minRows, 4));
  } else if (['comparison_table','decision_matrix','cost_table','timeline_table','scorecard','worksheet','severity_matrix'].includes(type)) {
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
  if (artifact.query_target) out.push(compact(artifact.query_target, 90));
  if (Array.isArray(artifact.extracted_requirements)) out.push(...artifact.extracted_requirements.filter((item) => String(item || '').length <= 90).slice(0, 10));
  if (Array.isArray(artifact.items)) out.push(...artifact.items.filter((item) => String(item || '').length <= 90).slice(0, 10));
  if (Array.isArray(artifact.lines)) out.push(...artifact.lines.filter((line) => String(line || '').length <= 90).slice(0, 10));
  // A required_string is a promise the trace enforces against the rendered page.
  // Requiring a build directive would compel the renderer to publish one.
  return unique(out).filter((value) => !isInternalInstructionText(value)).slice(0, 30);
}
// `artifact` lets a caller that has already compiled the artifact reuse it. Building
// it twice would advance the shared fallback-heading counter twice and number the
// page's headings 2, 4, 6.
function rowRequirementFromFix({ recommendation, query, recordId, implementationPath, index = 0, artifact = null }) {
  const built = artifact || artifactFromFix({ recommendation, query, recordId, index });
  return {
    row_id: recordId || '',
    query: query || '',
    implementation_path: implementationPath || '',
    source_fix: recommendation || '',
    required_blocks: [{
      type: built.type,
      heading_exact: built.title,
      columns_exact: built.headers || [],
      min_rows: Array.isArray(built.rows) ? built.rows.length : (built.items || built.lines || []).length,
      placement: /first screen|top|after the direct answer|immediately after/i.test(recommendation || '') ? 'near_top_or_requested_location' : 'rendered_content'
    }],
    required_strings: requiredStringsForArtifact(built, recommendation),
    block_reason_if_not_possible: 'VALIDATION_FAILED'
  };
}
function mergeArtifacts(artifacts) {
  return (artifacts || []).filter((artifact) => artifact && artifact.type && artifact.title && !containsInternalInstruction(artifact));
}
function compileEntryFromSpec(spec) {
  const implementationPath = spec.implementation_path || spec.intended_winner_path || '';
  const recommendations = unique(spec.fix_recommendations || spec.recommendations || [spec.recommendation]);
  const queries = unique(spec.queries || [spec.query]);
  const rowIds = unique(spec.record_ids || [spec.record_id]);
  const rowRequirements = [];
  const artifacts = [];
  // One counter for the whole page, so colliding fallback headings are numbered
  // 1..n across its recommendations rather than restarting per recommendation.
  const fallbackSeq = new Map();
  recommendations.forEach((recommendation, index) => {
    const query = queries[index] || queries[0] || spec.query || '';
    const recordId = rowIds[index] || rowIds[0] || spec.record_id || `${implementationPath}:${index}`;
    const artifact = artifactFromFix({ recommendation, query, recordId, index, fallbackSeq });
    artifacts.push(artifact);
    rowRequirements.push(rowRequirementFromFix({ recommendation, query, recordId, implementationPath, index, artifact }));
  });
  const mergedArtifacts = mergeArtifacts(artifacts);
  const requiredStrings = unique(
    mergedArtifacts.flatMap((artifact, index) => requiredStringsForArtifact(artifact, recommendations[index] || recommendations[0] || ''))
  ).slice(0, 80);
  return {
    implementation_path: implementationPath,
    title: mergedArtifacts[0]?.title || sentenceCase(spec.query || implementationPath),
    answer: compact(`Compare options by checking the concrete factors a user can verify: ${queries.join('; ') || implementationPath}. Do not rely on slogans, ranking labels, or vague authority claims when the page asks for side-by-side decision support.`, 520),
    checklist: unique(rowRequirements.flatMap((row) => row.required_strings || []).slice(0, 10)),
    red_flags: unique([
      'The rendered page does not include the exact requested heading, table, checklist, script, or callout.',
      'The page substitutes a generic framework for concrete decision-support content.',
      'The target route cannot be resolved deterministically.',
      'Visible content tells the reader to follow internal workflow notes instead of answering the query.'
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
  extractInstructionRequirements,
  normalizeSpace,
  compact,
  unique,
  stripPrefixes,
  quotedPhrases,
  artifactFromFix,
  rowRequirementFromFix,
  compileEntryFromSpec
};
