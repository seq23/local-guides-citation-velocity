#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const {
  LEDGER_PATH,
  entryFromSpec,
  mergeLedgerEntries,
  normalizeImplementationPath,
  targetTypeForImplementationPath
} = require('../lib/agent_exact_repairs');

function rel(p) { return path.join(ROOT, p); }
function readJson(p, f = null) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return f; } }
function writeJson(p, v) { const out = rel(p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(v, null, 2) + '\n'); }
function isLegacyHtmlReportArtifact(artifact) {
  const id = String(artifact?.id || artifact?.marker || '');
  return id.startsWith('html-report-');
}
function removeLegacyHtmlReportArtifacts(paths) {
  const targets = new Set([...paths].map((p) => normalizeImplementationPath(p)).filter(Boolean));
  if (!targets.size) return { cleaned_targets: 0, removed_artifacts: 0 };
  let cleanedTargets = 0;
  let removedArtifacts = 0;
  const insights = readJson('content/_live/insights.json', { items: [] });
  let insightsChanged = false;
  for (const item of insights.items || []) {
    const itemPath = normalizeImplementationPath(item.publish_path || (item.slug ? `insights/${item.slug}.html` : ''));
    if (!targets.has(itemPath) || !Array.isArray(item.citation_velocity_artifacts)) continue;
    const before = item.citation_velocity_artifacts.length;
    item.citation_velocity_artifacts = item.citation_velocity_artifacts.filter((artifact) => !isLegacyHtmlReportArtifact(artifact));
    removedArtifacts += before - item.citation_velocity_artifacts.length;
    if (before !== item.citation_velocity_artifacts.length) { cleanedTargets += 1; insightsChanged = true; }
  }
  if (insightsChanged) writeJson('content/_live/insights.json', insights);
  for (const relPath of ['content/_live/pages.json', 'content/_staged/pages.json']) {
    const payload = readJson(relPath, { pages: [] });
    let changed = false;
    for (const page of payload.pages || []) {
      const candidates = [
        normalizeImplementationPath(page.renderedPath || ''),
        normalizeImplementationPath(page.path || ''),
        normalizeImplementationPath(page.slug || '')
      ];
      if (!candidates.some((candidate) => targets.has(candidate)) || !Array.isArray(page.citation_velocity_artifacts)) continue;
      const before = page.citation_velocity_artifacts.length;
      page.citation_velocity_artifacts = page.citation_velocity_artifacts.filter((artifact) => !isLegacyHtmlReportArtifact(artifact));
      removedArtifacts += before - page.citation_velocity_artifacts.length;
      if (before !== page.citation_velocity_artifacts.length) { cleanedTargets += 1; changed = true; }
    }
    if (changed) writeJson(relPath, payload);
  }
  return { cleaned_targets: cleanedTargets, removed_artifacts: removedArtifacts };
}

function targetExists(spec, targetType, implementationPath) {
  const insights = readJson('content/_live/insights.json', { items: [] });
  const livePages = readJson('content/_live/pages.json', { pages: [] });
  if (targetType === 'generated_insight') {
    const slug = implementationPath.replace(/^insights\//, '').replace(/\.html$/, '');
    return (insights.items || []).some((item) => item && (item.slug === slug || normalizeImplementationPath(item.publish_path) === implementationPath));
  }
  if (targetType === 'live_page') {
    return (livePages.pages || []).some((page) => {
      const pageSlug = normalizeImplementationPath(page.slug || '');
      const pagePath = normalizeImplementationPath(page.path || '');
      return pageSlug === implementationPath || pagePath === implementationPath;
    });
  }
  return false;
}

function main() {
  const plan = readJson('artifacts/validation/agent-exact-implementation-plan.json', { specs: [] });
  const existingLedger = readJson(LEDGER_PATH, { schema_version: '1.0', entries: [] });
  const entries = [];
  const results = [];

  for (const spec of plan.specs || []) {
    if (spec.status === 'BLOCKED') {
      results.push({ ...spec, status: 'BLOCKED', blocked_reason: spec.blocked_reason || 'blocked_by_plan' });
      continue;
    }
    if (spec.operation !== 'REPAIR_INTENDED_WINNER_PAGE') {
      results.push({ ...spec, status: 'NOT_APPLIED_NON_REPAIR' });
      continue;
    }

    const entry = entryFromSpec(spec, DATE);
    const implementationPath = normalizeImplementationPath(entry.implementation_path);
    const targetType = entry.target_type || targetTypeForImplementationPath(implementationPath);
    if (!implementationPath || targetType === 'unknown') {
      results.push({ ...spec, status: 'BLOCKED_UNSUPPORTED_TARGET', target_type: targetType, blocked_reason: 'unsupported_or_missing_implementation_path' });
      continue;
    }

    entries.push(entry);
    results.push({
      ...spec,
      status: 'APPLIED_TO_LEDGER',
      target_type: targetType,
      implementation_path: implementationPath,
      marker: entry.marker,
      applied_manifest: LEDGER_PATH,
      target_seen_before_build: targetExists(spec, targetType, implementationPath)
    });
  }

  const mergedEntries = mergeLedgerEntries(existingLedger.entries || [], entries);
  const legacyCleanup = removeLegacyHtmlReportArtifacts(entries.map((entry) => entry.implementation_path));
  const ledger = {
    schema_version: '1.0',
    status: 'PASS',
    updated_at: DATE,
    source: 'agent-exact-implementation-plan',
    entry_count: mergedEntries.length,
    entries: mergedEntries
  };
  writeJson(LEDGER_PATH, ledger);

  const report = {
    schema_version: '1.1',
    status: 'PASS',
    applied_at: DATE,
    ledger_path: LEDGER_PATH,
    ledgered_repairs: entries.length,
    legacy_cleanup: legacyCleanup,
    blocked: results.filter((result) => String(result.status || '').startsWith('BLOCKED')).length,
    results
  };
  writeJson('artifacts/validation/agent-exact-implementation-apply.json', report);
  console.log(`AGENT EXACT IMPLEMENTATION APPLY PASS: ledgered_repairs=${entries.length}; ledger=${LEDGER_PATH}`);
}

main();
