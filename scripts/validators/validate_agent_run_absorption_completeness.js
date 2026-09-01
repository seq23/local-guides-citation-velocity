#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
// Did the water actually arrive?
//
// validate_agent_artifact_priority.js asserts the intake PLUMBING exists: that the
// workflow triggers on a manifest, that the mutation lane is wired, that the daily
// intelligence lane stays read-only. Every one of those checks passed on 2026-09-01
// while the dentistry run that landed that morning went almost entirely unabsorbed -
// 4 of its 12 named target files reached the implementation ledger, its reported 404
// stayed a 404, and 53 of its 70 planable specs were recorded CARRIED_NOT_WORKED.
// Wiring was proven. Delivery was not.
//
// This validator closes that gap. For every landed agent run it takes what the run
// ASKED FOR and checks the repo for what it GOT:
//
//   1. every FILEPATH the run named is either absorbed into the exact-implementation
//      ledger, or carries a named disposition (blocked/carried/held) that says why;
//   2. every route the run named RESOLVES - it exists as a published page, or a 301
//      in _redirects sends it somewhere that does. A reported 404 that is still a 404
//      is the failure this check exists for;
//   3. nothing is silently absent: a named target with no absorption AND no recorded
//      reason is a hard failure.
//
// It is vertical-agnostic by construction: it walks data/report_fixes/agent_runs/
// and reads whatever verticals are there, so a vertical that first appears tomorrow
// is checked with no code change naming it.
//
// Rule 0: examining zero runs is a FAILURE, not a pass on an empty loop.

const fs = require('fs');
const path = require('path');
const { resolveTargetPath, normalizeImplementationPath, statedFilepathFrom } = require('../lib/citation_route_resolver');

const ROOT = path.resolve(__dirname, '../..');
const AGENT_RUNS = 'data/report_fixes/agent_runs';
const NORMALIZED = 'data/report_fixes/normalized_agent_runs';
const LEDGER = 'data/report_fixes/agent_exact_implementation_ledger.json';
const PLAN = 'data/report_fixes/agent_exact_implementation_plan.json';
const LIVE_PAGES = 'content/_live/pages.json';
const INSIGHTS = 'content/_live/insights.json';
const REDIRECTS = '_redirects';
const OUT = 'artifacts/validation/agent-run-absorption-completeness.json';
const BASELINE = 'data/report_fixes/agent_run_absorption_baseline.json';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

function toRoute(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/index\.html$/, '');
  if (!out.startsWith('/')) out = `/${out}`;
  // "/insights/foo.html/" is the same document as "/insights/foo.html". Some source
  // artifacts carry the trailing slash; keeping it made every such route look missing.
  out = out.replace(/(\.[a-z0-9]+)\/+$/i, '$1');
  if (!out.endsWith('/') && !/\.[a-z0-9]+$/i.test(out)) out = `${out}/`;
  return out.replace(/\/{2,}/g, '/');
}
function toImplPath(value) {
  const route = toRoute(value);
  if (!route) return '';
  return /\.[a-z0-9]+$/i.test(route) ? route.replace(/^\//, '') : `${route.replace(/^\//, '')}index.html`;
}
// A value that is not a path at all (a whole FIX instruction, a prose title) is a
// defect in the SOURCE artifact, not evidence that absorption failed. It is reported
// as a malformed target so it stays visible, but it does not assert a missing page.
function looksLikeRoute(route) {
  return Boolean(route) && route.length <= 200 && !/\s|\|\|/.test(route) && /^\/[a-z0-9/_.-]+$/i.test(route);
}

function main() {
  const runsDir = rel(AGENT_RUNS);
  if (!fs.existsSync(runsDir)) {
    console.error(`AGENT RUN ABSORPTION COMPLETENESS FAIL: ${AGENT_RUNS} does not exist; there is nothing to prove absorption against.`);
    process.exit(1);
  }

  const ledger = readJson(LEDGER, { entries: [] });
  const absorbed = new Set();
  for (const entry of ledger.entries || []) {
    for (const key of ['implementation_path', 'intended_winner_page', 'intended_winner_path']) {
      const v = toImplPath(entry[key]);
      if (v) absorbed.add(v);
    }
    // Every URL the agent named for this page, kept across ledger merges.
    for (const alias of entry.resolver_aliases || []) {
      const v = toImplPath(alias);
      if (v) absorbed.add(v);
    }
  }

  // THE JOIN HAS TO GO THROUGH THE SAME RESOLVER THE INTAKE USED.
  //
  // A run names the URL it tested. The ledger records the page this repo actually
  // repaired, which scripts/lib/citation_route_resolver.js derived from that name and
  // is frequently a different string - insights/trt-002.html is
  // insights/trt-002-how-to-compare-trt-clinics-in-2026.html, and
  // uscis-medical/community-questionswhat-is-...-performs-it/ is the same page with the
  // missing slash restored. Comparing the raw name against the resolved path therefore
  // reported perfectly absorbed targets as silent drops. Two of the three findings in
  // the absorption ratchet were this, not a real absorption failure: both pages were in
  // the ledger the whole time, under the name the resolver gave them.
  //
  // Resolving here is not leniency. It is the same function, on the same input, so the
  // question asked is the one that matters: is the page the agent MEANT accounted for?
  const resolvedCache = new Map();
  const resolveNamed = (raw, context = {}) => {
    const key = `${String(raw || '')}\u0000${context.query || ''}\u0000${context.family || ''}`;
    if (!String(raw || '')) return '';
    if (resolvedCache.has(key)) return resolvedCache.get(key);
    let out = '';
    try {
      const verdict = resolveTargetPath({ value: raw, query: context.query || '', family: context.family || '' });
      out = verdict && !verdict.block_reason ? normalizeImplementationPath(verdict.implementation_path || '') : '';
    } catch { out = ''; }
    resolvedCache.set(key, out);
    return out;
  };

  // A spec the plan recorded - blocked, carried, or planned - is accounted for even
  // when it did not land. Absence of a RECORD is the defect; a recorded hold is not.
  const plan = readJson(PLAN, { specs: [] });
  const dispositions = new Map();
  // The plan records a row under the path the resolver RESOLVED it to, which is
  // frequently not the path the agent named. Keying the lookup on the named path
  // alone therefore missed rows that were perfectly well accounted for, and reported
  // them as silent drops. Record ids are the stable join between the two.
  const plannedRecordIds = new Set();
  for (const spec of plan.specs || []) {
    for (const id of [spec.record_id, ...(spec.record_ids || []), ...(spec.source_record_ids || []), spec.source_record_id]) {
      if (id) plannedRecordIds.add(String(id));
    }
  }
  for (const spec of plan.specs || []) {
    for (const key of ['implementation_path', 'intended_winner_path', 'intended_winner_page']) {
      const v = toImplPath(spec[key]);
      if (!v) continue;
      if (!dispositions.has(v)) dispositions.set(v, `${spec.status || 'UNKNOWN'}${spec.blocked_reason ? `:${spec.blocked_reason}` : ''}${spec.carried_reason ? `:${spec.carried_reason}` : ''}`);
    }
  }

  const livePages = readJson(LIVE_PAGES, { pages: [] });
  const realRoutes = new Set((livePages.pages || []).map((p) => toRoute(p.slug || p.path || '')).filter(Boolean));
  // Insights are published pages too, and most of what agent runs name are insight
  // routes. Checking only pages.json made every one of them look like a 404.
  const insights = readJson(INSIGHTS, { items: [] });
  for (const item of insights.items || []) {
    const publish = item.publish_path || (item.slug ? `insights/${item.slug}.html` : '');
    const route = toRoute(publish);
    if (route) realRoutes.add(route);
  }
  // Final authority on what is actually served: a file on disk at the rendered path.
  // A route can be legitimately published without appearing in either manifest.
  const existsOnDisk = (route) => {
    const impl = toImplPath(route);
    return Boolean(impl) && fs.existsSync(rel(impl));
  };
  const redirectFrom = new Map();
  try {
    for (const line of fs.readFileSync(rel(REDIRECTS), 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const [from, to] = t.split(/\s+/);
      if (from && to) redirectFrom.set(toRoute(from), toRoute(to));
    }
  } catch { /* absence is caught by the route checks below rather than guessed at */ }

  const runs = [];
  const errors = [];
  const warnings = [];
  let namedTargetsExamined = 0;

  for (const date of fs.readdirSync(runsDir).sort()) {
    const dateDir = path.join(runsDir, date);
    if (!fs.statSync(dateDir).isDirectory()) continue;
    for (const vertical of fs.readdirSync(dateDir).sort()) {
      const manifestRel = `${AGENT_RUNS}/${date}/${vertical}/agent_run_manifest.json`;
      const manifest = readJson(manifestRel, null);
      if (!manifest) continue;
      if (String(manifest.status || '') !== 'READY_FOR_ABSORPTION') continue;

      const normalizedRel = `${NORMALIZED}/${date}_${String(vertical).replace(/-/g, '_')}.json`;
      const altRel = `${NORMALIZED}/${date}_${vertical}.json`;
      const normalized = readJson(normalizedRel, null) || readJson(altRel, null);
      if (!normalized) {
        // Absorption has not even begun for this run. That is precisely the state
        // agent-artifact-continuity catches, so it is a warning here rather than a
        // duplicate hard failure from a second validator.
        warnings.push(`${date}/${vertical}:not_normalized_yet`);
        runs.push({ date, vertical, normalized: false, named_targets: 0, absorbed: 0, unaccounted: [], unresolved_routes: [] });
        continue;
      }

      // RESOLVE THE NAME BEFORE JUDGING IT.
      //
      // The join used to key on toImplPath(raw), which is a string operation with no
      // idea what a page is. Three shapes the agent uses routinely survive it as
      // garbage: a whole recommendation line ("FILEPATH: insights/trt-001-... || CURRENT:
      // ..."), a bullet-separated one, and a bare human title. Each produced a key no
      // ledger entry could ever match, and looksLikeRoute then dropped it as a malformed
      // source artifact - a warning, not a failure, so 50 of them piled up unread while
      // the pages they named sat absorbed in the ledger the whole time. That is the
      // 2026-07-29 TRT run reporting 0 of 32 absorbed.
      //
      // The resolver already understands all three shapes. Asking it first turns the key
      // into the path the agent MEANT, which is the only key the ledger was ever written
      // under.
      const named = new Map();
      for (const row of normalized.records || []) {
        const raw = row.repo_file_path || row.intended_winner_page || row.target_url || '';
        if (!String(raw).trim()) continue;
        // Same order the intake uses, from the same shared reader: the name first, and
        // only if that names no page, the FILEPATH the agent wrote into its own
        // recommendation text. Reading the artifact rather than trusting the intake's
        // stored answer keeps this an independent check - a wrong resolution upstream
        // still has to survive being derived again here.
        const resolvedImpl = resolveNamed(raw, { query: row.query || '', family: vertical })
          || resolveNamed(statedFilepathFrom(row.recommendation || row.fix_recommendation || ''), { query: row.query || '', family: vertical });
        const impl = resolvedImpl || toImplPath(raw);
        if (!impl) continue;
        const planned = plannedRecordIds.has(String(row.id))
          || (row.source_record_ids || []).some((x) => plannedRecordIds.has(String(x)))
          || plannedRecordIds.has(String(row.source_record_id));
        const existing = named.get(impl);
        if (!existing) named.set(impl, { route: toRoute(resolvedImpl || raw), named_as: String(raw).replace(/\s+/g, ' ').slice(0, 160), resolved: Boolean(resolvedImpl), planned, status: row.status || '' });
        else {
          if (planned) existing.planned = true;
          if (resolvedImpl) existing.resolved = true;
        }
      }

      const unaccounted = [];
      const unresolved = [];
      const heldRoutes = [];
      const unparseable = [];
      let absorbedHere = 0;
      for (const [impl, info] of named) {
        const route = info.route;
        namedTargetsExamined += 1;
        // The resolver could not make a page of this AND it is not path-shaped. That is
        // a target the repo cannot even ask a question about, so it is an ERROR, not a
        // warning. It used to be a warning, which is how 50 of them accumulated: a
        // finding nobody had to answer for is a finding nobody reads. Holding one now
        // costs a named entry in the ratchet, which can only ever shrink.
        if (!info.resolved && !looksLikeRoute(route)) { unparseable.push(info.named_as); continue; }
        const isAbsorbed = absorbed.has(impl);
        if (isAbsorbed) absorbedHere += 1;
        else if (!dispositions.has(impl) && !info.planned) unaccounted.push(impl);

        // Does the URL the agent tested actually resolve?
        if (realRoutes.has(route) || existsOnDisk(route)) continue;
        const hop = redirectFrom.get(route);
        if (hop && (realRoutes.has(hop) || existsOnDisk(hop) || redirectFrom.has(hop))) continue;
        // Resolution is demanded of what the repo CLAIMS to have fixed. An absorbed
        // target whose URL still 404s is the exact defect this validator exists for:
        // the ledger says the page was repaired while the address an answer engine
        // would follow returns nothing.
        //
        // A target that is blocked or carried has not been built and nobody claimed
        // otherwise. Its route not resolving is the recorded decision playing out, so
        // it is reported as a held route rather than failed - the same distinction
        // between a named stop and a failure that the release lane already draws.
        if (isAbsorbed) unresolved.push(route);
        else heldRoutes.push(`${route} (${dispositions.get(impl) || info.status || 'planned'})`);
      }

      for (const impl of unaccounted) errors.push(`${date}/${vertical}:named_target_unaccounted:${impl}`);
      for (const route of unresolved) errors.push(`${date}/${vertical}:named_route_does_not_resolve:${route}`);
      for (const value of unparseable) errors.push(`${date}/${vertical}:named_target_unparseable:${value}`);
      for (const value of heldRoutes) warnings.push(`${date}/${vertical}:named_route_held_unbuilt:${value}`);

      runs.push({
        date,
        vertical,
        normalized: true,
        named_targets: named.size,
        absorbed: absorbedHere,
        unaccounted,
        unresolved_routes: unresolved,
        unparseable_targets: unparseable,
        held_routes: heldRoutes
      });
    }
  }

  // Rule 0. A validator that examined nothing must never report success: an empty
  // loop and a clean repo are indistinguishable from the outside, and this check
  // exists precisely because a silent nothing looked like a pass for weeks.
  if (!runs.length) {
    console.error('AGENT RUN ABSORPTION COMPLETENESS FAIL: examined zero agent runs. Either no manifest is READY_FOR_ABSORPTION or the drop layout changed; both are defects, not a pass.');
    process.exit(1);
  }
  if (namedTargetsExamined === 0) {
    console.error(`AGENT RUN ABSORPTION COMPLETENESS FAIL: examined ${runs.length} run(s) but zero named targets. A run that asks for nothing is not a run that was absorbed.`);
    process.exit(1);
  }

  const report = {
    schema_version: '1.0',
    validator: 'agent-run-absorption-completeness',
    status: errors.length ? 'FAIL' : 'PASS',
    checked_at: new Date().toISOString(),
    runs_examined: runs.length,
    named_targets_examined: namedTargetsExamined,
    absorbed_targets: runs.reduce((n, r) => n + r.absorbed, 0),
    unaccounted_targets: errors.filter((e) => e.includes(':named_target_unaccounted:')).length,
    unresolved_routes: errors.filter((e) => e.includes(':named_route_does_not_resolve:')).length,
    unparseable_targets: errors.filter((e) => e.includes(':named_target_unparseable:')).length,
    runs,
    errors,
    warnings
  };
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });

  // Known pre-existing findings, dated and enumerated one by one. They are NOT
  // waived: the list may only ever shrink, and an entry that stops reproducing is a
  // hard failure telling you to delete it. Everything outside the list fails
  // immediately, which is what protects the runs landing from today onward.
  const baseline = readJson(BASELINE, { known_findings: [] });
  const known = new Set(baseline.known_findings || []);
  const newErrors = errors.filter((e) => !known.has(e));
  const staleBaseline = [...known].filter((k) => !errors.includes(k));
  report.baseline_known = known.size;
  report.baseline_still_reproducing = known.size - staleBaseline.length;
  report.baseline_stale = staleBaseline;
  report.new_errors = newErrors;
  report.status = (newErrors.length || staleBaseline.length) ? 'FAIL' : 'PASS';
  fs.writeFileSync(rel(OUT), `${JSON.stringify(report, null, 2)}\n`);

  if (staleBaseline.length) {
    console.error(`AGENT RUN ABSORPTION COMPLETENESS FAIL: ${staleBaseline.length} baseline entr(ies) no longer reproduce. A ratchet may only tighten - delete these from ${BASELINE}:`);
    for (const e of staleBaseline) console.error(`- ${e}`);
    process.exit(1);
  }
  if (newErrors.length) {
    console.error(`AGENT RUN ABSORPTION COMPLETENESS FAIL: ${runs.length} run(s); ${newErrors.length} NEW unabsorbed or unresolved item(s) beyond the ${known.size} known.`);
    for (const e of newErrors.slice(0, 40)) console.error(`- ${e}`);
    if (newErrors.length > 40) console.error(`- ... and ${newErrors.length - 40} more; see ${OUT}`);
    process.exit(1);
  }
  console.log(`AGENT RUN ABSORPTION COMPLETENESS PASS: ${runs.length} run(s); ${namedTargetsExamined} named target(s); ${report.absorbed_targets} absorbed; ${known.size} known pre-existing finding(s) still ratcheted; ${warnings.length} warning(s).`);
}

main();
