'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { deriveContentAtom } = require('./content_atom');
const { isInternalInstructionText, containsInternalInstruction, readerFacingQueryPrompt } = require('./internal_instruction_text');

const ROOT = path.resolve(__dirname, '../..');
const LEDGER_PATH = 'data/report_fixes/agent_exact_implementation_ledger.json';
const SEMANTIC_MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';

function unique(items) {
  return [...new Set((items || []).filter((item) => item !== undefined && item !== null && String(item).trim()).map((item) => String(item).trim()))];
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}


function readSemanticManifest() {
  const manifestPath = path.join(ROOT, SEMANTIC_MANIFEST_PATH);
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch {
    return { entries: [] };
  }
}

function semanticEntryForImplementationPath(implementationPath) {
  const normalized = normalizeImplementationPath(implementationPath);
  const manifest = readSemanticManifest();
  return (manifest.entries || []).find((entry) => {
    if (!entry) return false;
    if (normalizeImplementationPath(entry.implementation_path) === normalized) return true;
    return (entry.canonicalized_from || []).some((candidate) => normalizeImplementationPath(candidate) === normalized);
  }) || null;
}

function artifactsWithMarker(artifacts, marker) {
  const safe = (artifacts || []).filter((artifact) => artifact && artifact.type && artifact.title && !containsInternalInstruction(artifact)).map((artifact) => ({ ...artifact }));
  if (safe.length && marker) {
    safe[0].id = marker;
    safe[0].marker = marker;
  }
  return safe;
}

function mergeSemanticArtifacts(requiredArtifacts, existingArtifacts) {
  const byKey = new Map();
  for (const artifact of [...(requiredArtifacts || []), ...(existingArtifacts || [])]) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    if (String(artifact.title || '').startsWith('Agent Exact Repair Framework:')) continue;
    // Last line before render. A stale manifest - one imported by a baseline
    // snapshot rather than recompiled - can still carry a directive the current
    // compiler would never author.
    if (containsInternalInstruction(artifact)) continue;
    const key = artifact.marker || artifact.id || `${artifact.type}|${artifact.title}`;
    if (!byKey.has(key)) byKey.set(key, artifact);
  }
  return [...byKey.values()];
}

function compactSentence(value, max = 260) {
  const normalized = normalizeText(value);
  if (!normalized) return '';
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

function hash(value, len = 10) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, len);
}

function normalizeImplementationPath(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+\//, '');
  out = out.replace(/^\/+/, '');
  out = out.replace(/\?.*$/, '').replace(/#.*$/, '');
  if (out && !out.endsWith('.html') && !out.endsWith('.json') && !out.endsWith('.csv')) {
    out = out.replace(/\/+$/, '');
    out = out ? `${out}/index.html` : '';
  }
  return out.replace(/\/+/g, '/');
}

function routeToImplementationPath(value) {
  return normalizeImplementationPath(value);
}
function normalizedTargetRoute(value) {
  const impl = normalizeImplementationPath(value);
  if (!impl) return '';
  if (impl.endsWith('/index.html')) return `/${impl.slice(0, -'index.html'.length)}`;
  return `/${impl}`.replace(/\/{2,}/g, '/');
}

function routeVariants(value) {
  const normalized = normalizeImplementationPath(value);
  const variants = new Set();
  if (normalized) variants.add(normalized);
  if (normalized.endsWith('/index.html')) {
    variants.add(normalized.replace(/\/index\.html$/, '/'));
    variants.add(`/${normalized.replace(/\/index\.html$/, '/')}`);
  }
  if (normalized.endsWith('.html')) variants.add(`/${normalized}`);
  return variants;
}

function slugFromInsightPath(value) {
  return normalizeImplementationPath(value).replace(/^insights\//, '').replace(/\.html$/, '');
}

function targetTypeForImplementationPath(value) {
  const implementationPath = normalizeImplementationPath(value);
  if (implementationPath.startsWith('insights/') && implementationPath.endsWith('.html')) return 'generated_insight';
  if (implementationPath.endsWith('/index.html') || implementationPath.endsWith('.html')) return 'live_page';
  return 'unknown';
}

function markerFor(recordIds, implementationPath) {
  return `agent-exact-${hash(`${unique(recordIds).join('|')}|${normalizeImplementationPath(implementationPath)}`, 10)}`;
}

function entryFromSpec(spec, date) {
  const implementationPath = normalizeImplementationPath(spec.implementation_path || spec.intended_winner_path || routeToImplementationPath(spec.target_route));
  const recordIds = unique([...(spec.record_ids || [spec.record_id]), ...(spec.source_record_ids || [])]);
  const targetType = spec.target_type || targetTypeForImplementationPath(implementationPath);
  const queries = unique(spec.queries || [spec.query]);
  const fixRecommendations = unique(spec.fix_recommendations || spec.recommendations || [spec.recommendation]);
  const marker = markerFor(recordIds, implementationPath);
  const semantic = semanticEntryForImplementationPath(implementationPath);
  const sourceManifestId = normalizeText(spec.source_manifest_id || spec.source_run_id || spec.source_artifacts?.manifest || '');
  const targetIdentity = hash(`${sourceManifestId}|${recordIds.join('|')}|${normalizedTargetRoute(spec.target_route || implementationPath)}|${implementationPath}`, 24);
  return {
    schema_version: '1.1',
    marker,
    target_identity: targetIdentity,
    source_manifest_id: sourceManifestId,
    target_type: targetType,
    implementation_path: implementationPath,
    target_route: spec.target_route || '',
    intended_winner_page: spec.intended_winner_page || '',
    intended_winner_path: spec.intended_winner_path || implementationPath,
    supporting_routes: unique([spec.supporting_route]),
    record_ids: recordIds,
    source_record_ids: unique(spec.source_record_ids || []),
    queries,
    fix_recommendations: fixRecommendations,
    applied_at: date,
    source: 'twin_agent_artifact',
    status: spec.status === 'BLOCKED' ? 'BLOCKED' : 'LEDGERED',
    blocked_reason: spec.blocked_reason || '',
    semantic_manifest: semantic ? SEMANTIC_MANIFEST_PATH : '',
    semantic_repair_status: semantic ? 'SEMANTICALLY_APPLIED' : 'UNSTRUCTURED_REPAIR_REQUIRES_ACCEPTANCE',
    canonicalized_from: unique([...(spec.canonicalized_from || []), ...(semantic?.canonicalized_from || [])]),
    required_strings: unique(semantic?.required_strings || [])
  };
}

function mergeLedgerEntries(existingEntries, entries) {
  const byPath = new Map();
  for (const entry of existingEntries || []) {
    if (!entry || !entry.implementation_path) continue;
    const key = normalizeImplementationPath(entry.implementation_path);
    byPath.set(key, { ...entry, implementation_path: key });
  }
  for (const entry of entries || []) {
    if (!entry || !entry.implementation_path) continue;
    const key = normalizeImplementationPath(entry.implementation_path);
    const prior = byPath.get(key) || {};
    const priorRoute = normalizedTargetRoute(prior.target_route || prior.implementation_path || '');
    const nextRoute = normalizedTargetRoute(entry.target_route || entry.implementation_path || '');
    if (priorRoute && nextRoute && priorRoute !== nextRoute) {
      throw new Error(`agent_exact_cross_route_collision:${key}:${priorRoute}:${nextRoute}`);
    }
    const recordIds = unique([...(prior.record_ids || []), ...(entry.record_ids || [])]);
    const merged = {
      ...prior,
      ...entry,
      implementation_path: key,
      target_type: entry.target_type || prior.target_type || targetTypeForImplementationPath(key),
      record_ids: recordIds,
      queries: unique([...(prior.queries || []), ...(entry.queries || [])]),
      fix_recommendations: unique([...(prior.fix_recommendations || []), ...(entry.fix_recommendations || [])]),
      supporting_routes: unique([...(prior.supporting_routes || []), ...(entry.supporting_routes || [])]),
      marker: markerFor(recordIds, key),
      target_identities: unique([...(prior.target_identities || [prior.target_identity]), ...(entry.target_identities || [entry.target_identity])]),
      target_identity: entry.target_identity || prior.target_identity || ''
    };
    byPath.set(key, merged);
  }
  return [...byPath.values()].sort((a, b) => a.implementation_path.localeCompare(b.implementation_path));
}

function entriesForGeneratedInsight(ledger, item) {
  const keys = new Set([
    normalizeImplementationPath(item.publish_path || ''),
    normalizeImplementationPath(`insights/${item.slug || ''}.html`)
  ].filter(Boolean));
  return (ledger.entries || []).filter((entry) => entry.target_type === 'generated_insight' && keys.has(normalizeImplementationPath(entry.implementation_path)));
}

function entriesForLivePage(ledger, page) {
  const keys = new Set();
  for (const value of [page.slug, page.path]) {
    for (const variant of routeVariants(value)) keys.add(normalizeImplementationPath(variant));
  }
  return (ledger.entries || []).filter((entry) => entry.target_type === 'live_page' && keys.has(normalizeImplementationPath(entry.implementation_path)));
}

// Agent recommendations are internal build instructions. They arrive shaped like
//   "FILEPATH: x || CURRENT: ... || MISSING: ... || EDIT: ..."
// and must never reach reader-facing copy. They were reaching it two ways: as a
// checklist item in the fallback acceptance card, and appended to target.answer
// as "Citation-ready update: <instruction>". 163 published pages carried the
// first and 100 the second - including inside the direct-answer block, which is
// the exact text answer engines extract. That is also why the external agent
// kept re-reporting the same defects on pages marked released: it was reading
// its own instruction back off the page instead of the content it asked for.
//
// 2026-08-27: this predicate existed here, with that comment, and was never called
// from anywhere. Removing the two known leak sites fixed the two known leaks and left
// nothing standing between any *other* producer and a published page. A semantic
// manifest compiled from an agent report that quotes the directive back at us walked
// straight through, and insights/neuro-013 shipped an <h2> reading
// "Citation-ready update: FILEPATH...". The pattern list now lives in one module
// shared with the published-page gate, and the checks below actually run.
const looksLikeInternalInstruction = isInternalInstructionText;

function buildRepairArtifact(entry, primary, recommendation) {
  const semantic = semanticEntryForImplementationPath(entry.implementation_path || entry.intended_winner_path);
  if (semantic) {
    const artifacts = artifactsWithMarker(semantic.artifacts || [], entry.marker);
    if (artifacts.length) return artifacts[0];
  }
  // No semantic artifact means the requested content was never authored. The
  // previous fallback published an "acceptance checklist" card containing the
  // raw instruction plus build-policy lines ("Marker-only framework cards are
  // not sufficient for release"), which is internal process text on a public
  // page. Publishing a placeholder that announces the gap is worse than
  // publishing nothing: it is filler for readers, noise for extraction, and it
  // is what the agent then re-flags. Emit nothing and let the gap stay visible
  // in the ledger where it can be worked.
  return null;
}

function applyEntryToTarget(target, entry, context = {}) {
  if (!target || !entry || entry.status === 'BLOCKED') return target;
  const queries = unique(entry.queries || []);
  const recs = unique(entry.fix_recommendations || []);
  const primary = queries[0] || target.title || entry.implementation_path;
  const recommendation = recs[0] || 'Strengthen this page for citation extraction with direct-answer, verification, and source-first blocks.';
  const semantic = semanticEntryForImplementationPath(entry.implementation_path || entry.intended_winner_path);
  target.date_modified = entry.applied_at || target.date_modified;
  if (semantic) {
    // Each field is taken only if it is reader copy. A rejected field falls back to
    // what the page already had rather than to a directive.
    if (semantic.description && !looksLikeInternalInstruction(semantic.description)) target.description = compactSentence(semantic.description, 320);
    if (semantic.answer && !looksLikeInternalInstruction(semantic.answer)) target.answer = semantic.answer;
    target.checklist = unique([...(semantic.checklist || []), ...(target.checklist || [])]).filter((item) => !looksLikeInternalInstruction(item)).slice(0, 14);
    target.red_flags = unique([...(semantic.red_flags || []), ...(target.red_flags || [])]).filter((item) => !looksLikeInternalInstruction(item)).slice(0, 14);
    target.source_records = unique([...(semantic.authority_source_ids || []), ...(target.source_records || [])]);
  } else {
    target.description = target.description || compactSentence(target.title || primary, 320);
    // Never append the instruction to the answer. This block is what answer
    // engines quote; an internal directive inside it is both wrong for readers
    // and actively harmful for citation.
    target.answer = compactSentence(target.answer || target.description || target.title || primary, 520);
    target.checklist = unique([
      ...(target.checklist || []),
      // Was `Directly answer: ${query}` - the instruction, published as a
      // checklist item. This is the site that put three of them inside the
      // dentistry cost hub's own Direct answer block.
      ...queries.slice(0, 3).map((query) => readerFacingQueryPrompt(query)),
      'Verify current primary source and jurisdiction before acting',
      'Preserve distinction between general guidance and fact-specific advice'
    ]).slice(0, 12);
    target.red_flags = unique([
      ...(target.red_flags || []),
      'Confirm the answer is stated plainly near the top of the page',
      'Confirm any claim that needs authority cites a named primary source'
    ]).slice(0, 10);
  }
  target.agent_exact_repair = {
    marker: entry.marker,
    last_repaired_at: entry.applied_at,
    source: entry.source || 'twin_agent_artifact',
    record_ids: unique(entry.record_ids || []),
    source_record_ids: unique(entry.source_record_ids || []),
    queries,
    fix_recommendations: recs,
    repair_summary: compactSentence(semantic ? `Semantic repair applied from ${SEMANTIC_MANIFEST_PATH}` : 'Unstructured repair pending semantic authoring', 300),
    competitor_gap_summary: compactSentence(recs.join(' | '), 400),
    supporting_routes: unique(entry.supporting_routes || []),
    semantic_manifest: semantic ? SEMANTIC_MANIFEST_PATH : '',
    semantic_repair_status: semantic ? 'SEMANTICALLY_APPLIED' : 'UNSTRUCTURED_REPAIR_REQUIRES_ACCEPTANCE'
  };
  const exactArtifact = buildRepairArtifact(entry, primary, recommendation);
  const semanticArtifacts = semantic ? artifactsWithMarker(semantic.artifacts || [], entry.marker) : [];
  const existing = (target.citation_velocity_artifacts || []).filter((artifact) => artifact && artifact.marker !== entry.marker && artifact.id !== entry.marker && !String(artifact.title || '').startsWith('Agent Exact Repair Framework:'));
  target.citation_velocity_artifacts = semantic
    ? mergeSemanticArtifacts(semanticArtifacts, existing)
    : mergeSemanticArtifacts(exactArtifact ? [exactArtifact] : [], existing);
  target.content_atom = deriveContentAtom({
    title: target.title || primary,
    definition: target.answer || target.description,
    checklist: target.checklist,
    red_flags: target.red_flags,
    citation_velocity_artifacts: target.citation_velocity_artifacts
  }, { sourceRoute: context.sourceRoute || target.publish_path || target.slug || entry.implementation_path, title: target.title || primary });
  return target;
}

function applyAgentExactRepairsToInsightItem(item, ledger) {
  const matches = entriesForGeneratedInsight(ledger || { entries: [] }, item || {});
  for (const entry of matches) applyEntryToTarget(item, entry, { sourceRoute: item.publish_path });
  return item;
}

function applyAgentExactRepairsToPage(page, ledger) {
  const matches = entriesForLivePage(ledger || { entries: [] }, page || {});
  for (const entry of matches) applyEntryToTarget(page, entry, { sourceRoute: page.slug });
  return page;
}

module.exports = {
  LEDGER_PATH,
  unique,
  compactSentence,
  normalizeImplementationPath,
  routeToImplementationPath,
  normalizedTargetRoute,
  slugFromInsightPath,
  targetTypeForImplementationPath,
  markerFor,
  entryFromSpec,
  mergeLedgerEntries,
  entriesForGeneratedInsight,
  entriesForLivePage,
  applyAgentExactRepairsToInsightItem,
  applyAgentExactRepairsToPage,
  semanticEntryForImplementationPath
};
