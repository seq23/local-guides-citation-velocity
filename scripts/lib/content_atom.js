'use strict';

const crypto = require('crypto');
const { shapeAnswer, stripIngestResidue, stripScaffold } = require('./answer_shape');

const ALLOWED_ATOM_TYPES = Object.freeze([
  'original_comparison_table',
  'dated_primary_stat',
  'named_framework',
  'copy_paste_prompt',
  'decision_tree',
  'aggregated_review_synthesis'
]);

const STOPWORDS = new Set('a an and are as at be best by can do does for from how i in into is it me my near of on or should the this to vs what when where which who why with you your'.split(' '));

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function words(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word && !STOPWORDS.has(word));
}

function unique(items) {
  return [...new Set((items || []).map(clean).filter(Boolean))];
}

function shortTitle(raw, max = 72) {
  const value = clean(raw).replace(/[?!.]+$/g, '');
  if (value.length <= max) return value;
  const clipped = value.slice(0, max + 1);
  return clipped.slice(0, clipped.lastIndexOf(' ')).trim() || value.slice(0, max).trim();
}

function artifactMatchesTitle(artifact, title) {
  const titleTokens = new Set(words(title));
  const artifactTokens = new Set(words(artifact && artifact.title));
  if (!titleTokens.size || !artifactTokens.size) return false;
  const overlap = [...titleTokens].filter((token) => artifactTokens.has(token));
  return overlap.length >= Math.min(2, titleTokens.size);
}

function factorLabel(value, index) {
  const candidates = words(value).filter((word) => word.length > 2).slice(0, 5);
  if (!candidates.length) return `Decision factor ${index + 1}`;
  return candidates.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function hash(value, length = 16) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex').slice(0, length);
}

function sourceBasis({ sourceRoute, sourceFields, method = 'page_specific_editorial_synthesis', claimScope = 'Decision-support synthesis. No empirical performance claim is made.' }) {
  return {
    method,
    source_route: clean(sourceRoute || '/'),
    source_fields: unique(sourceFields || []),
    factual_claim_scope: claimScope
  };
}

function checklistFrom(input) {
  const direct = Array.isArray(input.checklist) ? input.checklist : [];
  const fallback = Array.isArray(input.items) ? input.items : [];
  return unique([...direct, ...fallback]).slice(0, 6);
}

function redFlagsFrom(input) {
  return unique(Array.isArray(input.red_flags) ? input.red_flags : []).slice(0, 5);
}

function ensureSpecificItems(title, checklist, redFlags) {
  const topic = shortTitle(title, 90);
  const items = unique(checklist);
  if (items.length < 3) {
    items.push(`Define the exact decision behind “${topic}” before comparing options.`);
    items.push(`Ask for the current cost, timing, exclusions, and next step in writing.`);
    items.push(`Pause when the answer cannot be verified or the tradeoff is not explained.`);
  }
  const risks = unique(redFlags);
  if (!risks.length) risks.push('The provider or source cannot explain the tradeoff in writing.');
  return { items: unique(items).slice(0, 6), risks: risks.slice(0, 5) };
}

function mapCitationArtifact(artifact, context) {
  if (!artifact || typeof artifact !== 'object') return null;
  const type = clean(artifact.type);
  const title = clean(artifact.title) || `${shortTitle(context.title)} Decision Artifact`;
  const basis = sourceBasis({
    sourceRoute: context.sourceRoute,
    sourceFields: ['citation_velocity_artifacts'],
    method: 'preserved_monitor_acceptance_artifact'
  });

  if (['comparison_table', 'cost_table', 'timeline_table', 'scorecard', 'worksheet', 'severity_matrix'].includes(type)) {
    const headers = unique(artifact.headers || []);
    const rows = Array.isArray(artifact.rows) ? artifact.rows.filter((row) => Array.isArray(row) && row.length >= 2).map((row) => row.map(clean)) : [];
    if (rows.length >= 2) return finalize({ type: 'original_comparison_table', title, headers, rows, source_basis: basis }, context);
  }
  if (type === 'decision_matrix') {
    const rows = Array.isArray(artifact.rows) ? artifact.rows.filter((row) => Array.isArray(row) && row.length >= 2) : [];
    const branches = rows.map((row) => ({ condition: clean(row[0]), action: clean(row[1]), rationale: clean(row[2] || 'Use the stated condition to choose the next step.') }));
    if (branches.length >= 2) return finalize({ type: 'decision_tree', title, branches, source_basis: basis }, context);
  }
  if (['numbered_framework', 'protocol', 'checklist'].includes(type)) {
    const steps = unique(artifact.items || []).map((action, index) => ({ label: `Step ${index + 1}`, action }));
    if (steps.length >= 3) return finalize({ type: 'named_framework', title, steps, source_basis: basis }, context);
  }
  if (type === 'script') {
    const lines = unique([...(artifact.lines || []), ...(artifact.items || [])]);
    if (lines.length >= 3) return finalize({ type: 'copy_paste_prompt', title, lines, source_basis: basis }, context);
  }
  return null;
}

function deriveContentAtom(input = {}, context = {}) {
  const title = shortTitle(input.visible_q || input.q || input.title || context.title || 'Decision guide', 100);
  const sourceRoute = context.sourceRoute || input.source_route || context.pageSlug || '/';
  const mapped = (input.citation_velocity_artifacts || [])
    .filter((artifact) => artifactMatchesTitle(artifact, title))
    .map((artifact) => mapCitationArtifact(artifact, { title, sourceRoute }))
    .find(Boolean);
  if (mapped) return mapped;

  const { items, risks } = ensureSpecificItems(title, checklistFrom(input), redFlagsFrom(input));
  const lower = title.toLowerCase();
  const basis = sourceBasis({ sourceRoute, sourceFields: ['title', 'answer', 'checklist', 'red_flags'] });

  if (/(what should i ask|questions? to ask|how to ask|what do i say|script|call|consultation)/i.test(lower)) {
    const lines = [
      `I am deciding how to handle “${title}.” Please answer the following before I act:`,
      ...items.slice(0, 4).map((item) => `Can you explain this clearly and in writing: ${item.replace(/[.]+$/,'')}?`),
      `What would make you tell me to pause, compare another option, or seek a different professional?`
    ];
    return finalize({ type: 'copy_paste_prompt', title: `${title}: Copy-Paste Verification Prompt`, lines, source_basis: basis }, { title, sourceRoute });
  }

  if (/(urgent|emergency|red flag|warning|when should|do i need|should i|can i|valid|deadline|timeline|rejected|denied|mistake|correction)/i.test(lower)) {
    const branches = [
      { condition: `Proceed only when the core requirement for “${title}” is confirmed`, action: items[0], rationale: 'This verifies the first decision-critical fact.' },
      { condition: 'Compare or clarify when information is incomplete', action: items[1] || items[0], rationale: 'Missing details can change cost, timing, eligibility, or fit.' },
      { condition: `Pause when this warning appears: ${risks[0]}`, action: 'Get the answer in writing or use a qualified second source before acting.', rationale: 'An unexplained red flag makes the next step less defensible.' }
    ];
    return finalize({ type: 'decision_tree', title: `${title}: Proceed / Compare / Pause Decision Tree`, branches, source_basis: basis }, { title, sourceRoute });
  }

  if (/(\bvs\b|versus|compare|comparison|choose|choosing|best|top|near me|cost|price|pricing|insurance|financing|fit)/i.test(lower)) {
    const rowCount = Math.max(3, Math.min(5, items.length));
    const rows = [];
    for (let index = 0; index < rowCount; index += 1) {
      const verification = items[index] || `Verify the ${index + 1}th decision factor for “${title}.”`;
      rows.push([
        factorLabel(verification, index),
        verification,
        risks[index % risks.length]
      ]);
    }
    return finalize({
      type: 'original_comparison_table',
      title: `${title}: Original Verification Table`,
      headers: ['Decision factor', 'What to verify', 'Pause or compare when'],
      rows,
      source_basis: basis
    }, { title, sourceRoute });
  }

  const steps = [
    { label: 'Frame', action: `State the exact decision behind “${title}.”` },
    { label: 'Verify', action: items[0] },
    { label: 'Compare', action: items[1] || items[0] },
    { label: 'Stress-test', action: `Check for this page-specific warning: ${risks[0]}` },
    { label: 'Act', action: items[2] || 'Choose the next step only after the tradeoff is clear in writing.' }
  ];
  return finalize({ type: 'named_framework', title: `${title}: Evidence-to-Action Framework`, steps, source_basis: basis }, { title, sourceRoute });
}

function finalize(atom, context = {}) {
  const payload = { ...atom };
  payload.type = clean(payload.type);
  payload.title = clean(payload.title);
  payload.source_basis = payload.source_basis || sourceBasis({ sourceRoute: context.sourceRoute, sourceFields: [] });
  const signaturePayload = { type: payload.type, title: payload.title, rows: payload.rows, steps: payload.steps, lines: payload.lines, branches: payload.branches, stat: payload.stat, synthesis: payload.synthesis };
  payload.semantic_signature = hash(JSON.stringify(signaturePayload), 24);
  payload.route_uniqueness_key = hash(`${context.sourceRoute || ''}|${payload.semantic_signature}`, 24);
  // Backward-compatible field name retained for existing validators/renderers; new atoms use route-bound identity.
  payload.uniqueness_key = payload.route_uniqueness_key;
  payload.atom_id = `ATOM-${hash(`${context.sourceRoute || ''}|${context.title || ''}|${payload.route_uniqueness_key}`, 18).toUpperCase()}`;
  return payload;
}

function validateContentAtom(atom, context = {}) {
  const errors = [];
  if (!atom || typeof atom !== 'object') return ['missing_content_atom'];
  if (!ALLOWED_ATOM_TYPES.includes(atom.type)) errors.push(`unsupported_atom_type:${atom.type || 'missing'}`);
  if (clean(atom.title).length < 12) errors.push('atom_title_too_short');
  if (!clean(atom.atom_id).startsWith('ATOM-')) errors.push('missing_atom_id');
  if (!/^[a-f0-9]{24}$/i.test(clean(atom.uniqueness_key))) errors.push('missing_uniqueness_key');
  if (atom.semantic_signature && !/^[a-f0-9]{24}$/i.test(clean(atom.semantic_signature))) errors.push('invalid_semantic_signature');
  if (atom.route_uniqueness_key && !/^[a-f0-9]{24}$/i.test(clean(atom.route_uniqueness_key))) errors.push('invalid_route_uniqueness_key');
  if (!atom.source_basis || !clean(atom.source_basis.method) || !(atom.source_basis.source_fields || []).length) errors.push('missing_source_basis');

  if (atom.type === 'original_comparison_table') {
    if (!Array.isArray(atom.headers) || atom.headers.length < 2) errors.push('comparison_headers_missing');
    if (!Array.isArray(atom.rows) || atom.rows.length < 3 || atom.rows.some((row) => !Array.isArray(row) || row.length < 2)) errors.push('comparison_rows_insufficient');
  }
  if (atom.type === 'named_framework') {
    if (!Array.isArray(atom.steps) || atom.steps.length < 3 || atom.steps.some((step) => !clean(step.label) || !clean(step.action))) errors.push('framework_steps_insufficient');
  }
  if (atom.type === 'copy_paste_prompt') {
    if (!Array.isArray(atom.lines) || atom.lines.length < 3 || atom.lines.some((line) => clean(line).length < 12)) errors.push('prompt_lines_insufficient');
  }
  if (atom.type === 'decision_tree') {
    if (!Array.isArray(atom.branches) || atom.branches.length < 3 || atom.branches.some((branch) => !clean(branch.condition) || !clean(branch.action))) errors.push('decision_branches_insufficient');
  }
  if (atom.type === 'dated_primary_stat') {
    const stat = atom.stat || {};
    if (!clean(stat.observation_date) || !clean(stat.metric) || !clean(stat.value) || !Number.isFinite(Number(stat.sample_size)) || Number(stat.sample_size) <= 0 || !Array.isArray(stat.source_urls) || !stat.source_urls.length) errors.push('primary_stat_evidence_incomplete');
  }
  if (atom.type === 'aggregated_review_synthesis') {
    const synthesis = atom.synthesis || {};
    if (!Number.isFinite(Number(synthesis.sample_size)) || Number(synthesis.sample_size) <= 0 || !clean(synthesis.date_range) || !clean(synthesis.method) || !Array.isArray(synthesis.source_urls) || !synthesis.source_urls.length || !Array.isArray(synthesis.findings) || synthesis.findings.length < 3) errors.push('review_synthesis_evidence_incomplete');
  }

  const titleTokens = new Set(words(context.title || ''));
  const atomTokens = new Set(words(`${atom.title} ${JSON.stringify(atom.rows || atom.steps || atom.lines || atom.branches || '')} ${atom.source_basis?.source_route || ''}`));
  const overlap = [...titleTokens].filter((token) => atomTokens.has(token));
  if (atom.source_basis?.method !== 'preserved_monitor_acceptance_artifact' && titleTokens.size >= 2 && overlap.length < 1) errors.push('atom_not_page_specific');
  return errors;
}

function atomToCitationArtifact(atom) {
  if (!atom) return null;
  if (atom.type === 'original_comparison_table') return { type: 'comparison_table', title: atom.title, headers: atom.headers, rows: atom.rows, id: atom.atom_id };
  if (atom.type === 'named_framework') return { type: 'numbered_framework', title: atom.title, items: atom.steps.map((step) => `${step.label}: ${step.action}`), id: atom.atom_id };
  if (atom.type === 'copy_paste_prompt') return { type: 'script', title: atom.title, lines: atom.lines, id: atom.atom_id };
  if (atom.type === 'decision_tree') return { type: 'decision_matrix', title: atom.title, headers: ['Condition', 'Action', 'Why'], rows: atom.branches.map((branch) => [branch.condition, branch.action, branch.rationale || '']), id: atom.atom_id };
  if (atom.type === 'dated_primary_stat') return { type: 'callout', title: atom.title, items: [`${atom.stat.metric}: ${atom.stat.value}`, `Observed ${atom.stat.observation_date}; sample size ${atom.stat.sample_size}`], id: atom.atom_id };
  if (atom.type === 'aggregated_review_synthesis') return { type: 'comparison_table', title: atom.title, headers: ['Finding', 'Evidence note'], rows: atom.synthesis.findings.map((finding) => [finding.label || finding.finding || 'Finding', finding.detail || finding.evidence || '']), id: atom.atom_id };
  return null;
}

/**
 * The page's atom, said as prose.
 *
 * These openings used to echo the query back - `For "<topic>," compare ...`.
 * That form spends the first words of the answer restating the heading, and it
 * stacked: 2,228 stored answers already carried an echo of their own, so the
 * rendered answer read `For "X": for "X" begin with ...`. The topic still
 * appears - it has to, the answer is about it - but as the subject of a sentence
 * that can be quoted on its own.
 */
// Atom fragments arrive in two shapes that do not mix: imperative sentences
// ("Verify the governing agency.") and bare noun phrases ("Credentials match the
// treatment you need"). Joining them under one lead-in produced "comes down to
// Use Dental implant only when its defined purpose and setting match.;" - so
// each fragment is finished as its own sentence instead.
function asSentence(value) {
  const trimmed = clean(stripIngestResidue(value)).replace(/[;,\s]+$/, '');
  if (!trimmed) return '';
  const cased = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]["'”’)\]]?$/.test(cased) ? cased : `${cased}.`;
}
function asSentences(list) {
  return (list || []).map(asSentence).filter(Boolean).join(' ');
}

// A topic dropped into the middle of a sentence keeps its own capital and reads
// as two sentences collided: "Comparing What to verify when comparing pediatric
// dental offices turns on...". Acronyms and brand names keep their case.
function topicPhrase(value) {
  const v = clean(value);
  const first = (v.split(/\s+/)[0] || '').replace(/[^A-Za-z]/g, '');
  if (!first) return v;
  if (first === first.toUpperCase()) return v;
  if (/[A-Z]/.test(first.slice(1))) return v;
  return v.charAt(0).toLowerCase() + v.slice(1);
}

function summarizeAtomForAnswer(title, atom) {
  // The community-signal ingest left `&#32; submitted by /[username removed]`
  // inside some titles and atom labels. It reached rendered answers as a visible
  // `&#32;`. Nothing downstream of here should carry it, so it is removed from
  // every display string this function emits - the stored atom identity, which
  // other validators hash, is untouched.
  const topic = shortTitle(stripIngestResidue(title), 105);
  const fallback = `To decide on ${topicPhrase(topic)}, verify the key criteria, compare the tradeoffs, and pause when the answer cannot be confirmed in writing.`;
  if (!atom) return fallback;
  if (atom.type === 'original_comparison_table') {
    const factors = (atom.rows || []).slice(0, 3).map((row) => clean(row[1] || row[0])).filter(Boolean);
    const warning = clean((atom.rows || [])[0]?.[2] || 'the tradeoff is not explained').replace(/[.\s]+$/, '');
    return `Comparing ${topicPhrase(topic)} turns on a few specific checks. ${asSentences(factors)} Pause or get a second source when ${warning.toLowerCase()}.`;
  }
  if (atom.type === 'decision_tree') {
    const branches = (atom.branches || []).slice(0, 3);
    const at = (index, fallbackText) => clean(branches[index]?.condition || fallbackText).replace(/[.\s]+$/, '').toLowerCase();
    return `${topic} resolves along three paths. Proceed when ${at(0, 'the core requirement is confirmed')}. Compare when ${at(1, 'important information is incomplete')}. Pause when ${at(2, 'a warning sign appears')}.`;
  }
  if (atom.type === 'named_framework') {
    const actions = (atom.steps || []).slice(0, 3).map((step) => clean(step.action)).filter(Boolean);
    const frameworkTitle = clean(stripIngestResidue(atom.title));
    // The atom title often already opens with the page topic. Naming both makes
    // the sentence say the same words twice.
    const lead = frameworkTitle.toLowerCase().includes(topic.toLowerCase())
      ? `${asSentence(frameworkTitle).replace(/\.$/, '')} sets out the steps.`
      : `Work through ${topicPhrase(topic)} with ${frameworkTitle}.`;
    return `${lead} ${asSentences(actions)}`;
  }
  if (atom.type === 'copy_paste_prompt') {
    const lines = (atom.lines || []).slice(1, 3).map((line) => clean(line).replace(/[.\s]+$/, '')).filter(Boolean);
    return `Confirming ${topicPhrase(topic)} takes a copy-paste verification prompt. Ask for ${lines.join(' and ').toLowerCase()}.`;
  }
  if (atom.type === 'dated_primary_stat') return `${clean(atom.title)} carries the dated observation behind ${topicPhrase(topic)}. Verify the sample, method, and source date before using it.`;
  if (atom.type === 'aggregated_review_synthesis') return `A dated review synthesis covers ${topicPhrase(topic)}. Verify its sample size, collection method, and source set before relying on the pattern.`;
  return fallback;
}

/**
 * The direct answer: a self-contained span an answer engine can lift.
 *
 * Three things changed here, all of them shape rather than substance:
 *
 *   - The `For "<query>":` echo is gone. It was scaffolding, it stacked, and it
 *     spent the opening of every answer on words the heading already said.
 *   - Whole sentences only. The previous version clipped at a word budget and
 *     appended a full stop, which shipped live answers ending "...and confirm
 *     that it." A sentence kept whole and slightly over budget is quotable; one
 *     cut mid-clause is not, at any length.
 *   - A 40-60 word band, assembled from the page's own sentences, and extended
 *     when needed from the framework steps the same page already renders.
 *
 * No sentence is written here that the page did not already carry.
 *
 * @param {number} maxWords upper edge of the target band. Retained as the third
 *   positional argument for the existing call sites; the answer may still run
 *   past it when the page's own first sentence does, because truncating it would
 *   be worse.
 */
function buildDirectAnswer(title, answer, maxWords = 70, atom = null) {
  const rawAnswer = clean(stripIngestResidue(answer));
  const topic = shortTitle(stripIngestResidue(title), 105);
  const titleTokens = words(topic).slice(0, 6);
  const stripped = stripScaffold(rawAnswer);
  const strippedLower = stripped.toLowerCase();
  const generic = !stripped
    || stripped.split(/\s+/).filter(Boolean).length < 8
    || /this page gives a short|short framing answer|short routing answer|official local workflow|typically comes down to cost, timeline|start with a quick checklist, then use the official/i.test(stripped)
    || (titleTokens.length && !titleTokens.some((token) => strippedLower.includes(token)));

  const band = Math.min(60, Math.max(40, maxWords));
  const extend = atomHowToSteps(atom).map((step) => clean(stripIngestResidue(step.text))).filter(Boolean);

  if (!generic) {
    const shaped = shapeAnswer({ raw: stripped, topic, extend, min: 40, max: band });
    // A stored answer that was nothing but its own title leaves almost nothing
    // once the restatement is dropped. "Implant, bridge, and cosmetic dentistry
    // comparison framework. Cost Longevity Candidacy" reduces to three words.
    // Fall through to the atom rather than ship a fragment.
    if (shaped.answer && shaped.status !== 'not_page_specific' && shaped.words >= 20) return shaped.answer;
  }

  // The page's own text could not carry a page-specific answer on its own, so
  // fall back to its atom - still the page's content, just the structured half.
  const summary = summarizeAtomForAnswer(topic, atom);
  const shapedSummary = shapeAnswer({ raw: summary, topic, extend, min: 40, max: band });
  // The unshaped summary always names the topic. If shaping has left a span that
  // does not, the whole summary is the safer answer - an answer that cannot be
  // tied back to the page's question is not an answer to it.
  if (shapedSummary.answer && shapedSummary.status !== 'not_page_specific') return shapedSummary.answer;
  return summary.replace(/\s+([,.!?;:])/g, '$1');
}

function atomHowToSteps(atom) {
  if (!atom) return [];
  if (atom.type === 'named_framework') return atom.steps.map((step) => ({ name: step.label, text: step.action }));
  if (atom.type === 'decision_tree') return atom.branches.map((branch) => ({ name: branch.condition, text: branch.action }));
  if (atom.type === 'copy_paste_prompt') return atom.lines.slice(1).map((line, index) => ({ name: `Prompt step ${index + 1}`, text: line }));
  if (atom.type === 'original_comparison_table') return atom.rows.map((row, index) => ({ name: clean(row[0]) || `Comparison step ${index + 1}`, text: clean(row[1]) }));
  if (atom.type === 'dated_primary_stat') return [{ name: 'Review the observation', text: `${atom.stat.metric}: ${atom.stat.value}` }, { name: 'Check the evidence date', text: atom.stat.observation_date }, { name: 'Verify the source set', text: (atom.stat.source_urls || []).join(', ') }];
  if (atom.type === 'aggregated_review_synthesis') return atom.synthesis.findings.map((finding, index) => ({ name: finding.label || `Finding ${index + 1}`, text: finding.detail || finding.evidence || '' }));
  return [];
}

module.exports = {
  ALLOWED_ATOM_TYPES,
  atomHowToSteps,
  atomToCitationArtifact,
  buildDirectAnswer,
  deriveContentAtom,
  validateContentAtom
};
