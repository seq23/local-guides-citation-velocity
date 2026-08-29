#!/usr/bin/env node
'use strict';
/**
 * Delete a backlog entry once its route is built.
 *
 * The declared backlog in data/content/unbuilt_rich_page_backlog.json is now
 * drained by the release lane (scripts/content/build_page_release_queue.js
 * reads it as a third intake lane). The moment scripts/velocity_content_release.js
 * stages one of those routes, the declaration is stale - and
 * scripts/validators/validate_rich_new_page_contract.js hard-fails on a stale
 * declaration, deliberately, because a backlog entry that outlived its cause is
 * the next version of the bug it was written to stop.
 *
 * So the drain has two halves and this is the second one. Without it the first
 * successful drain would turn main red.
 *
 * Rule 0: this exits non-zero if it cannot read the backlog. "Nothing to
 * reconcile" is a real and common outcome - most runs build nothing, because
 * the governed ceiling is 2 new URLs a day - but it is reported as a named
 * no-op, not as silence.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const BACKLOG_REL = 'data/content/unbuilt_rich_page_backlog.json';
const RECEIPT_REL = 'artifacts/validation/unbuilt-backlog-reconcile.json';

const read = (rel, fallback = null) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return fallback; } };
const write = (rel, value) => { const abs = path.join(ROOT, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, JSON.stringify(value, null, 2) + '\n'); };

const backlog = read(BACKLOG_REL, null);
if (!backlog || !Array.isArray(backlog.routes)) {
  console.error(`UNBUILT BACKLOG RECONCILE: STOP - ${BACKLOG_REL} is missing or carries no routes array.`);
  console.error('  The declared backlog is the only record of which admitted routes are knowingly unbuilt. Without it, every unbuilt page is a silent gap again, and this reconciler cannot tell a drained entry from a deleted one.');
  process.exit(1);
}

const live = read('content/_live/pages.json', { pages: [] });
const staged = read('content/_staged/pages.json', { pages: [] });
const known = new Set([...(live.pages || []), ...(staged.pages || [])].map((p) => p.path || p.slug).filter(Boolean));
const builtOnDisk = (route) => {
  const rel = String(route || '').replace(/^\/+|\/+$/g, '');
  if (!rel) return false;
  return fs.existsSync(path.join(ROOT, rel, 'index.html')) || fs.existsSync(path.join(ROOT, `${rel}.html`));
};
const isBuilt = (route) => known.has(route) || builtOnDisk(route);

const drained = [];
const kept = [];
for (const entry of backlog.routes) {
  if (entry && entry.route && String(entry.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE' && isBuilt(entry.route)) {
    drained.push({ route: entry.route, first_admitted_on: entry.first_admitted_on || null, waited_days: entry.first_admitted_on ? Math.round((Date.now() - Date.parse(`${entry.first_admitted_on}T00:00:00Z`)) / 86400000) : null });
  } else {
    kept.push(entry);
  }
}

const awaiting = kept.filter((e) => String(e.disposition || '').toUpperCase() === 'AWAITING_RELEASE_LANE').length;
if (drained.length) {
  backlog.routes = kept;
  backlog.declared_count = kept.length;
  backlog.drainable_count = awaiting;
  backlog.retired_count = kept.length - awaiting;
  backlog.last_drained_on = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
  write(BACKLOG_REL, backlog);
}

write(RECEIPT_REL, {
  schema_version: '1.0',
  status: 'PASS',
  drained_count: drained.length,
  drained,
  remaining_declared: backlog.routes.length,
  remaining_awaiting_release_lane: awaiting,
  note: drained.length
    ? 'Entries whose routes are now built were deleted from the declared backlog.'
    : 'No declared backlog entry became built on this run. The governed ceiling is 2 new URLs a day, so most runs legitimately drain nothing; this is a named no-op, not a silent one.'
});

console.log(`UNBUILT BACKLOG RECONCILE PASS: drained=${drained.length}; still awaiting the release lane=${awaiting}; declared total=${backlog.routes.length}`);
for (const row of drained) console.log(`  built and removed: ${row.route} (waited ${row.waited_days} day(s) since ${row.first_admitted_on})`);
