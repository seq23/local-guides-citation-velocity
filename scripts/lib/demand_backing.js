'use strict';
/**
 * ONE demand-backing predicate, shared by the producer and the gate.
 *
 * WHY THIS FILE EXISTS
 *
 * The demand gate lived only in scripts/validation/validate_demand_backed_pages.js,
 * downstream of the thing that actually admits routes. scripts/velocity_content_release.js
 * selected new pages on `eligible && decision === 'SAFE_AUTOPUBLISH' &&
 * lifecycle_state === 'ADMITTED_FOR_BUILD'` and applied NO demand predicate at all, so
 * the release lane could stage a route the gate was guaranteed to reject a few steps
 * later in the same job. Two components each keeping their own list, with no link.
 *
 * Reproduced on runs 33320678174 and 33321455226: the 2/day ceiling picked
 * /dentistry/guides/dental-bridge-vs-implant-which-is-better/ out of 46 admitted rows,
 * that route matched no query in data/demand/measured_demand.json, and the release
 * lane went red - having built a page it was never allowed to publish.
 *
 * The renderer and the sitemap were fixed the same way (scripts/lib/page_admission.js):
 * share the predicate rather than restate it. Nothing here is looser than what the
 * validator asserted - it is character-for-character the same match, moved to where
 * both callers can reach it.
 */
const fs = require('fs');
const path = require('path');
const { normalizeRoute } = require('./page_admission');

const ROOT = path.resolve(__dirname, '..', '..');
const DEMAND_REL = 'data/demand/measured_demand.json';

/**
 * The measured queries, as route-comparable slugs.
 * Throws if the demand file is unreadable: an unreadable demand corpus must never
 * read as "nothing is demand-backed" to the gate, nor as "everything passes" to the
 * producer. Callers decide how to stop; neither may default.
 */
function demandSlugs(rootDir = ROOT) {
  const raw = fs.readFileSync(path.join(rootDir, DEMAND_REL), 'utf8');
  const demand = JSON.parse(raw);
  const queries = new Set((demand.records || []).map((r) => String(r.query_normalized || r.query).toLowerCase()));
  return [...queries].map((q) => q.replace(/[^a-z0-9]+/g, '-')).filter(Boolean);
}

/** True when `route` carries a measured query in its path. */
function isDemandBacked(route, slugs) {
  const normalized = normalizeRoute(route);
  if (!normalized) return false;
  return slugs.some((s) => s && normalized.includes(s));
}

/** Convenience for callers that only test a handful of routes. */
function demandBackingPredicate(rootDir = ROOT) {
  const slugs = demandSlugs(rootDir);
  const predicate = (route) => isDemandBacked(route, slugs);
  predicate.slugCount = slugs.length;
  return predicate;
}

/**
 * Publishing freeze (data/search_intelligence/publishing_freeze.json, 11 Oct 2026).
 * While enabled, a NEW page may publish only when its route carries a query with a
 * measured NUMBER: Search Console impressions in data/search_intelligence/
 * gsc_search_analytics_export.json, or a measured_demand record with volume > 0.
 * T3 and owner-seed rows (real phrasing, no number) back existing pages but no
 * longer admit new ones. A held row is not consumed, so it publishes on the first
 * release after its query is measured.
 */
const FREEZE_REL = 'data/search_intelligence/publishing_freeze.json';
const GSC_EXPORT_REL = 'data/search_intelligence/gsc_search_analytics_export.json';
function publishingFreeze(rootDir = ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(rootDir, FREEZE_REL), 'utf8')); } catch (_) { return { enabled: false }; }
}
function measuredNumberPredicate(rootDir = ROOT) {
  const demand = JSON.parse(fs.readFileSync(path.join(rootDir, DEMAND_REL), 'utf8'));
  const qs = (demand.records || []).filter((r) => Number(r.volume) > 0).map((r) => String(r.query_normalized || r.query).toLowerCase());
  let gsc = null;
  try { gsc = JSON.parse(fs.readFileSync(path.join(rootDir, GSC_EXPORT_REL), 'utf8')); } catch (_) { gsc = null; }
  for (const r of (gsc && gsc.by_query) || []) if (r.impressions > 0) qs.push(String(r.query).toLowerCase());
  const slugs = [...new Set(qs.map((q) => q.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')).filter(Boolean))];
  const predicate = (route) => isDemandBacked(route, slugs);
  predicate.slugCount = slugs.length;
  return predicate;
}

module.exports = { DEMAND_REL, FREEZE_REL, demandSlugs, isDemandBacked, demandBackingPredicate, publishingFreeze, measuredNumberPredicate };
