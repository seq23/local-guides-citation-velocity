#!/usr/bin/env node
'use strict';
/**
 * The declared unbuilt backlog must have a consumer.
 *
 * Incident, 2026-08-29. 136 routes were discovered, classified, marked
 * READY_TO_RELEASE and admitted for build, and then never built - the oldest
 * waiting since 2026-06-23. The backlog was declared, counted, dated and
 * printed on every validator run, and it could no longer grow silently. What it
 * could do was sit there forever: scripts/content/build_page_release_queue.js
 * read the approval queue and the measured atlas and nothing else, so an
 * admitted row that landed in the backlog had no path back out. A queue with no
 * consumer is the same defect as measured demand that produces nothing, wearing
 * the paperwork of a decision.
 *
 * The drain was wired on 2026-08-29. This validator is what stops it being
 * quietly unwired again, and it checks four things a broken drain would show:
 *
 *   1. Every entry carries a disposition. AWAITING_RELEASE_LANE means it is a
 *      build candidate; RETIRED means somebody decided not to build it and said
 *      why. An entry with neither is an unaudited exemption.
 *   2. Every RETIRED entry carries a reason code and a reason. A retirement
 *      without a reason is a deletion with extra steps.
 *   3. Every AWAITING_RELEASE_LANE entry is actually admitted by the release
 *      law - it appears in data/release/page_release_queue.json as eligible
 *      SAFE_AUTOPUBLISH. An entry the law refuses can never drain, so leaving
 *      it marked as awaiting is a promise the system cannot keep.
 *   4. If anything is awaiting, the queue admits at least one backlog row. That
 *      is the consumer existing, expressed as a fact rather than as a comment.
 *
 * Rule 0: it hard-fails if it examined zero entries AND the backlog file is
 * absent or unreadable. An empty backlog with the file present is the success
 * state - it means the drain finished - and is reported as a named stop, not
 * as a pass over nothing.
 */
const fs = require('fs');
const path = require('path');
const ROOT = process.cwd();
const BACKLOG_REL = 'data/content/unbuilt_rich_page_backlog.json';
const QUEUE_REL = 'data/release/page_release_queue.json';
const CEILING_REL = 'data/authority_scale/velocity_decision.json';

const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { return null; } };
const problems = [];

const backlog = read(BACKLOG_REL);
if (!backlog || !Array.isArray(backlog.routes)) {
  console.error(`UNBUILT BACKLOG DRAIN: FAIL - ${BACKLOG_REL} is missing or unreadable, so this validator examined zero entries and cannot pass. The declared backlog is the only record of which admitted routes are knowingly unbuilt.`);
  process.exit(1);
}
const queue = read(QUEUE_REL);
if (!queue || !Array.isArray(queue.records)) {
  console.error(`UNBUILT BACKLOG DRAIN: FAIL - ${QUEUE_REL} is missing or unreadable. Without the release queue there is no way to tell whether the backlog has a consumer, and passing on that is the failure this validator exists to catch.`);
  process.exit(1);
}

const admittedByLaw = new Set(queue.records
  .filter((r) => r.eligible === true && r.decision === 'SAFE_AUTOPUBLISH' && r.lifecycle_state === 'ADMITTED_FOR_BUILD')
  .map((r) => r.target_route));
const offeredFromBacklog = queue.records.filter((r) => r.source === 'unbuilt_rich_page_backlog');

const awaiting = [];
const retired = [];
for (const entry of backlog.routes) {
  const route = entry && entry.route;
  if (!route) { problems.push('A backlog entry carries no route.'); continue; }
  const disposition = String(entry.disposition || '').toUpperCase();
  if (disposition === 'AWAITING_RELEASE_LANE') {
    awaiting.push(entry);
    if (!admittedByLaw.has(route)) {
      problems.push(`${route} is declared AWAITING_RELEASE_LANE but the release law does not admit it in ${QUEUE_REL}. It can never drain, so declaring it as waiting is a promise the lane cannot keep. Either fix what the law objects to, or retire the entry with a reason.`);
    }
  } else if (disposition === 'RETIRED') {
    retired.push(entry);
    if (!entry.retirement_reason_code || !entry.retirement_reason) {
      problems.push(`${route} is RETIRED with no retirement_reason_code and reason. A retirement without a recorded reason is a deletion with extra steps.`);
    }
  } else {
    problems.push(`${route} carries disposition "${entry.disposition || '(none)'}". Every backlog entry is either a build candidate (AWAITING_RELEASE_LANE) or a recorded decision not to build it (RETIRED); anything else is an unaudited exemption.`);
  }
}

const examined = backlog.routes.length;

// The consumer must exist. If routes are waiting, the queue must be offering
// them - an empty offer with a non-empty backlog is the original defect back.
if (awaiting.length && !offeredFromBacklog.length) {
  problems.push(`${awaiting.length} route(s) are awaiting the release lane, but ${QUEUE_REL} carries no record sourced from the backlog at all. The drain has been disconnected: nothing reads the backlog, so nothing will ever build it.`);
}
if (awaiting.length && offeredFromBacklog.length && !offeredFromBacklog.some((r) => r.eligible === true)) {
  problems.push(`The backlog is offered to the release law but every one of its ${offeredFromBacklog.length} row(s) is refused, so the drain rate is zero. A consumer that refuses everything is not a consumer.`);
}

// Reporting only: how long the backlog takes to clear at the governed rate. The
// ceiling is read, never defaulted - the same rule the release lane applies.
const decision = read(CEILING_REL);
const ceiling = decision && Number.isFinite(Number(decision.recommended_new_url_ceiling_per_day)) ? Number(decision.recommended_new_url_ceiling_per_day) : null;

console.log('Unbuilt rich page backlog drain');
console.log(`  declared entries examined        : ${examined}`);
console.log(`  awaiting the release lane        : ${awaiting.length}`);
console.log(`  retired with a recorded reason   : ${retired.length}`);
console.log(`  offered to the release law       : ${offeredFromBacklog.length}`);
console.log(`  admitted for build by the law    : ${offeredFromBacklog.filter((r) => r.eligible === true).length}`);
if (ceiling === null) {
  console.log(`  governed new-URL ceiling         : UNREADABLE in ${CEILING_REL} - the release lane will halt on this before it publishes anything`);
} else if (ceiling > 0) {
  console.log(`  governed new-URL ceiling         : ${ceiling}/day`);
  console.log(`  clears in                        : ${Math.ceil(awaiting.length / ceiling)} release day(s) at that rate`);
} else {
  console.log('  governed new-URL ceiling         : 0/day - a declared full stop on new URLs, so the backlog is held, not stalled');
}
if (!examined) {
  console.log('');
  console.log('NAMED STOP: the declared backlog is empty. Every admitted route has been built or retired; there is nothing left to drain.');
}
if (retired.length) {
  const byCode = {};
  for (const e of retired) byCode[e.retirement_reason_code] = (byCode[e.retirement_reason_code] || 0) + 1;
  for (const [code, n] of Object.entries(byCode)) console.log(`    ${code}: ${n}`);
}

if (problems.length) {
  console.error('');
  for (const p of problems) console.error(`VALIDATION FAIL: ${p}`);
  process.exit(1);
}
console.log('');
console.log('PASS: every declared backlog entry is either admitted for build by the release law or retired with a recorded reason.');
