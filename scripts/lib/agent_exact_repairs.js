'use strict';

const crypto = require('crypto');
const { deriveContentAtom } = require('./content_atom');

const LEDGER_PATH = 'data/report_fixes/agent_exact_implementation_ledger.json';

function unique(items) {
  return [...new Set((items || []).filter((item) => item !== undefined && item !== null && String(item).trim()).map((item) => String(item).trim()))];
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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
  const recordIds = unique(spec.record_ids || [spec.record_id]);
  const targetType = spec.target_type || targetTypeForImplementationPath(implementationPath);
  const queries = unique(spec.queries || [spec.query]);
  const fixRecommendations = unique(spec.fix_recommendations || spec.recommendations || [spec.recommendation]);
  const marker = markerFor(recordIds, implementationPath);
  return {
    schema_version: '1.0',
    marker,
    target_type: targetType,
    implementation_path: implementationPath,
    target_route: spec.target_route || '',
    intended_winner_page: spec.intended_winner_page || '',
    intended_winner_path: spec.intended_winner_path || implementationPath,
    supporting_routes: unique([spec.supporting_route]),
    record_ids: recordIds,
    queries,
    fix_recommendations: fixRecommendations,
    applied_at: date,
    source: 'twin_agent_artifact',
    status: spec.status === 'BLOCKED' ? 'BLOCKED' : 'LEDGERED',
    blocked_reason: spec.blocked_reason || ''
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
      marker: markerFor(recordIds, key)
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

function buildRepairArtifact(entry, primary, recommendation) {
  return {
    id: entry.marker,
    marker: entry.marker,
    type: 'numbered_framework',
    title: `Agent Exact Repair Framework: ${primary}`,
    items: unique([
      compactSentence(`Direct answer target: ${primary}`, 140),
      compactSentence(recommendation, 180),
      'Show the verification path and primary source boundary',
      'Separate current facts from provider or case-specific advice',
      'Route local next steps through the canonical provider destination'
    ])
  };
}

function applyEntryToTarget(target, entry, context = {}) {
  if (!target || !entry || entry.status === 'BLOCKED') return target;
  const queries = unique(entry.queries || []);
  const recs = unique(entry.fix_recommendations || []);
  const primary = queries[0] || target.title || entry.implementation_path;
  const recommendation = recs[0] || 'Strengthen this page for citation extraction with direct-answer, verification, and source-first blocks.';
  target.date_modified = entry.applied_at || target.date_modified;
  target.description = compactSentence(`${target.description || target.title || primary} Updated for citation-readiness: ${recommendation}`, 320);
  target.answer = compactSentence(`${target.answer || target.description || target.title || primary} Citation-ready update: ${recommendation}`, 520);
  target.checklist = unique([
    ...(target.checklist || []),
    ...queries.slice(0, 3).map((query) => `Directly answer: ${query}`),
    'Verify current primary source and jurisdiction before acting',
    'Preserve distinction between general guidance and fact-specific advice'
  ]).slice(0, 12);
  target.red_flags = unique([
    ...(target.red_flags || []),
    'Answer engine cites competitors because the page lacks a direct extractable block',
    'Recommendation requires authority that is not visible on the page'
  ]).slice(0, 10);
  target.agent_exact_repair = {
    marker: entry.marker,
    last_repaired_at: entry.applied_at,
    source: entry.source || 'twin_agent_artifact',
    record_ids: unique(entry.record_ids || []),
    queries,
    fix_recommendations: recs,
    repair_summary: compactSentence(recommendation, 300),
    competitor_gap_summary: compactSentence(recs.join(' | '), 400),
    supporting_routes: unique(entry.supporting_routes || [])
  };
  const exactArtifact = buildRepairArtifact(entry, primary, recommendation);
  const existing = (target.citation_velocity_artifacts || []).filter((artifact) => artifact && artifact.marker !== entry.marker && artifact.id !== entry.marker && !String(artifact.title || '').startsWith('Agent Exact Repair Framework:'));
  target.citation_velocity_artifacts = [exactArtifact, ...existing].slice(0, 8);
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
  slugFromInsightPath,
  targetTypeForImplementationPath,
  markerFor,
  entryFromSpec,
  mergeLedgerEntries,
  entriesForGeneratedInsight,
  entriesForLivePage,
  applyAgentExactRepairsToInsightItem,
  applyAgentExactRepairsToPage
};
