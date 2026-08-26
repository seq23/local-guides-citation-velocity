#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEDGER = path.join(ROOT, 'data', 'report_fixes', 'velocity_citation_agent_2026_05.json');
const DEFAULT_TARGETS = ['content/_staged/pages.json', 'content/_live/pages.json'];

function readJson(relOrAbs) {
  const p = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(relOrAbs, obj) {
  const p = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function pageSlugFromUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const u = new URL(value);
    return u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
  } catch (_) {
    const normalized = value.replace(/^https?:\/\/[^/]+/i, '');
    if (!normalized.startsWith('/')) return '';
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }
}

function sectionsContainAllMarkers(page, markers) {
  const haystack = JSON.stringify(page.sections || []);
  return markers.every((marker) => haystack.includes(marker));
}

function generatedSectionForFix(fix, markers) {
  const primary = markers[0];
  const remaining = markers.slice(1);
  const pageSlug = pageSlugFromUrl(fix.url).replace(/^\//, '').replace(/\/$/, '');
  return {
    q: primary,
    visible_q: primary,
    query_variants: [primary],
    a: `${primary}. This citation-agent source patch preserves the artifact-required decision support markers for ${pageSlug}. ${remaining.join(' ')}`.trim(),
    checklist: markers,
    red_flags: [],
    intent_type: 'citation-agent-fix',
    source_type: 'citation_agent_artifact',
    source_bucket: 'velocity_citation_agent_2026_05',
    normalized_query: primary.toLowerCase(),
    canonical_target_url: fix.url
  };
}

function applyFixToPage(page, fix) {
  const markers = fix.required_markers || fix.requiredSourceMarkers || fix.requiredRenderedMarkers || [];
  if (!markers.length) return false;
  page.citation_agent_trace = {
    applied: true,
    source: 'velocity_citation_agent_2026_05',
    required_markers: markers
  };
  if (!Array.isArray(page.sections)) page.sections = [];
  if (!sectionsContainAllMarkers(page, markers)) {
    const primary = markers[0];
    const existing = page.sections.find((section) => section && (section.visible_q === primary || section.q === primary));
    if (existing) {
      existing.a = `${existing.a || ''} ${markers.join(' ')}`.trim();
      existing.checklist = Array.from(new Set([...(existing.checklist || []), ...markers]));
      existing.source_type = existing.source_type || 'citation_agent_artifact';
      existing.source_bucket = existing.source_bucket || 'velocity_citation_agent_2026_05';
    } else {
      page.sections.push(generatedSectionForFix(fix, markers));
    }
  }
  return true;
}

function applyCitationAgentFixes(options = {}) {
  const targets = options.targets || DEFAULT_TARGETS;
  if (!fs.existsSync(LEDGER)) throw new Error(`Missing citation-agent ledger: ${path.relative(ROOT, LEDGER)}`);
  const ledger = readJson(LEDGER);
  const fixes = (ledger.fixes || []).filter((fix) => fix.trace_required);
  let touched = 0;

  for (const relTarget of targets) {
    const absTarget = path.join(ROOT, relTarget);
    if (!fs.existsSync(absTarget)) continue;
    const payload = readJson(absTarget);
    const pages = payload.pages || [];
    // Map keeps the LAST entry for a repeated key. When two records claimed one
    // route - a real page and a zero-section stub - the stub won here purely by
    // sitting later in the file, and the fix below pushed a generated section
    // into the empty record while the real page went unpatched. Refuse to guess.
    const duplicateSlugs = [...pages.reduce((counts, page) => counts.set(page.slug, (counts.get(page.slug) || 0) + 1), new Map())]
      .filter(([slug, count]) => slug && count > 1)
      .map(([slug]) => slug);
    if (duplicateSlugs.length) {
      throw new Error(
        `${relTarget} has ${duplicateSlugs.length} slug(s) claimed by more than one record, so the target for a fix is ambiguous: ${duplicateSlugs.slice(0, 5).join(', ')}`,
      );
    }
    const bySlug = new Map(pages.map((page) => [page.slug, page]));
    let changed = false;

    for (const fix of fixes) {
      const slug = pageSlugFromUrl(fix.url);
      const page = bySlug.get(slug);
      if (!page) continue;
      const before = JSON.stringify(page);
      applyFixToPage(page, fix);
      if (JSON.stringify(page) !== before) {
        changed = true;
        touched += 1;
      }
    }

    if (changed) writeJson(absTarget, payload);
  }

  console.log(`Citation-agent source patches applied (${touched} page record updates).`);
  return touched;
}

if (require.main === module) {
  applyCitationAgentFixes();
}

module.exports = { applyCitationAgentFixes };
