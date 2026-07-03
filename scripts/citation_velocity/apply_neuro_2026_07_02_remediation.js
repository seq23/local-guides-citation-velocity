#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { deriveContentAtom } = require('../lib/content_atom');
const ROOT = path.resolve(__dirname, '../..');
const MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_manifests/2026-07-02_neuro.json';
const ACTIVE_MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';
const INSIGHTS_PATH = 'content/_live/insights.json';
const PAGES_PATH = 'content/_live/pages.json';
const STAGED_PAGES_PATH = 'content/_staged/pages.json';
const DATE = '2026-07-02';

function rel(p) { return path.join(ROOT, p); }
function readJson(p) { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); }
function writeJson(p, v) { fs.writeFileSync(rel(p), JSON.stringify(v, null, 2) + '\n'); }
function normalize(p) {
  let out = String(p || '').trim().replace(/^https?:\/\/[^/]+\//, '').replace(/^\/+/, '').replace(/\?.*$/, '').replace(/#.*$/, '');
  if (out && !out.endsWith('.html') && !out.endsWith('.json') && !out.endsWith('.csv')) out = out.replace(/\/+$/, '') + '/index.html';
  return out.replace(/\/+/, '/');
}
function slugFromPath(p) { return normalize(p).replace(/^insights\//, '').replace(/\.html$/, ''); }
function unique(items) { return [...new Set((items || []).filter(Boolean).map(x => String(x).trim()).filter(Boolean))]; }
function compact(value, max = 420) { const s = String(value || '').replace(/\s+/g, ' ').trim(); return s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`; }
function artifactKey(a) { return `${a.type || ''}|${a.title || ''}`; }
function mergeArtifacts(existing, required) {
  const removeGeneric = (existing || []).filter(a => a && !String(a.title || '').startsWith('Agent Exact Repair Framework:'));
  const byKey = new Map();
  for (const artifact of [...required, ...removeGeneric]) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    byKey.set(artifactKey(artifact), artifact);
  }
  return [...byKey.values()].slice(0, 12);
}
function applyToInsight(item, manifestEntry) {
  item.date_modified = DATE;
  item.description = `${manifestEntry.title}. Updated with the July 2, 2026 neuro Citation Velocity semantic repair so the page exposes the exact checklist, table, script, or callout requested by the agent run.`;
  item.answer = manifestEntry.answer;
  item.checklist = unique([...(manifestEntry.checklist || []), ...(item.checklist || [])]).slice(0, 14);
  item.red_flags = unique([...(manifestEntry.red_flags || []), ...(item.red_flags || [])]).slice(0, 14);
  item.citation_velocity_artifacts = mergeArtifacts(item.citation_velocity_artifacts, manifestEntry.artifacts || []);
  item.agent_exact_repair = {
    ...(item.agent_exact_repair || {}),
    semantic_repair_status: 'SEMANTICALLY_APPLIED',
    semantic_manifest: MANIFEST_PATH,
    semantic_repaired_at: DATE,
    canonicalized_from: manifestEntry.canonicalized_from || [],
    required_strings: manifestEntry.required_strings || []
  };
  item.content_atom = deriveContentAtom({
    title: item.title,
    definition: item.answer || item.description,
    checklist: item.checklist,
    red_flags: item.red_flags,
    citation_velocity_artifacts: item.citation_velocity_artifacts
  }, { sourceRoute: item.publish_path || `/${manifestEntry.implementation_path}`, title: item.title });
}
function applyToPage(page, manifestEntry) {
  page.date_modified = DATE;
  page.description = compact(`${page.title} ${manifestEntry.answer}`, 320);
  page.citation_velocity_artifacts = mergeArtifacts(page.citation_velocity_artifacts, manifestEntry.artifacts || []);
  page.sections = Array.isArray(page.sections) ? page.sections : [];
  if (page.sections.length) {
    page.sections[0].a = manifestEntry.answer;
    page.sections[0].checklist = unique([...(manifestEntry.checklist || []), ...(page.sections[0].checklist || [])]).slice(0, 12);
    page.sections[0].red_flags = unique([...(manifestEntry.red_flags || []), ...(page.sections[0].red_flags || [])]).slice(0, 12);
  }
  page.content_atom = deriveContentAtom({
    title: page.title,
    definition: manifestEntry.answer || page.description,
    checklist: manifestEntry.checklist,
    red_flags: manifestEntry.red_flags,
    citation_velocity_artifacts: page.citation_velocity_artifacts
  }, { sourceRoute: page.slug || page.path || manifestEntry.implementation_path, title: page.title });
  page.agent_exact_repair = {
    semantic_repair_status: 'SEMANTICALLY_APPLIED',
    semantic_manifest: MANIFEST_PATH,
    semantic_repaired_at: DATE,
    canonicalized_from: manifestEntry.canonicalized_from || [],
    required_strings: manifestEntry.required_strings || []
  };
}

function main() {
  const manifest = readJson(MANIFEST_PATH);
  writeJson(ACTIVE_MANIFEST_PATH, manifest);
  const insights = readJson(INSIGHTS_PATH);
  const pages = readJson(PAGES_PATH);
  const stagedPages = readJson(STAGED_PAGES_PATH);
  const insightBySlug = new Map((insights.items || []).map(item => [item.slug, item]));
  const pageByPath = new Map();
  const stagedPageByPath = new Map();
  for (const page of pages.pages || []) {
    if (page.path) pageByPath.set(normalize(page.path), page);
    if (page.slug) pageByPath.set(normalize(page.slug), page);
  }
  for (const page of stagedPages.pages || []) {
    if (page.path) stagedPageByPath.set(normalize(page.path), page);
    if (page.slug) stagedPageByPath.set(normalize(page.slug), page);
  }
  const results = [];
  for (const entry of manifest.entries || []) {
    const implementationPath = normalize(entry.implementation_path);
    if (implementationPath.startsWith('insights/')) {
      const item = insightBySlug.get(slugFromPath(implementationPath));
      if (!item) throw new Error(`Missing insight item for ${implementationPath}`);
      applyToInsight(item, entry);
      results.push({ implementation_path: implementationPath, status: 'SEMANTICALLY_APPLIED', target_type: 'insight' });
    } else {
      const page = pageByPath.get(implementationPath);
      if (!page) throw new Error(`Missing live page for ${implementationPath}`);
      applyToPage(page, entry);
      const stagedPage = stagedPageByPath.get(implementationPath);
      if (stagedPage) applyToPage(stagedPage, entry);
      results.push({ implementation_path: implementationPath, status: 'SEMANTICALLY_APPLIED', target_type: 'live_page', staged_applied: Boolean(stagedPage) });
    }
  }
  writeJson(INSIGHTS_PATH, insights);
  writeJson(PAGES_PATH, pages);
  writeJson(STAGED_PAGES_PATH, stagedPages);
  const report = {
    schema_version: '1.0',
    status: 'PASS',
    applied_at: DATE,
    manifest: MANIFEST_PATH,
    active_manifest: ACTIVE_MANIFEST_PATH,
    result_count: results.length,
    results
  };
  writeJson('artifacts/validation/neuro-2026-07-02-semantic-remediation-apply.json', report);
  console.log(`NEURO 2026-07-02 SEMANTIC REMEDIATION PASS: ${results.length} target(s)`);
}

main();
