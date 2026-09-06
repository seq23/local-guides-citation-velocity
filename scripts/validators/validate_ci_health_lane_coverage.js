#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A workflow that pushes to main must be watched by the CI health lane.
 *
 * ci-health-recovery.yml watched one workflow: "Validate Repo". Velocity Content
 * Release - the surface that publishes - ran red on 2026-09-04, 2026-09-05 and twice
 * on 2026-09-06, and the health lane reported SUCCESS at every one of those times.
 * Nothing was inert and no loop passed on empty: Validate Repo really was green, and
 * the lane answered honestly about the only thing it could see. A three-day outage on
 * the publishing lane raised no alert because it was never in frame. Four workflows
 * push to main and none of them was observed.
 *
 * That is not a bug in the alerting code, so no amount of testing the alerting code
 * would have found it. It is a gap between two lists that nothing compared. This
 * validator compares them:
 *
 *   - every workflow whose body runs `git push` must appear in the health lane's
 *     workflow_run.workflows list, by its exact `name:`;
 *   - "Validate Repo" must be watched, because it is the validator that governs them;
 *   - every watched name must match a real workflow's `name:`. A typo watches nothing
 *     and reports nothing, which is the same failure wearing a different hat;
 *   - the recorded per-lane health must be internally consistent, and the rollup must
 *     agree with the lanes it summarises.
 *
 * Rule 0: examining zero workflows, or finding zero committing lanes, is a FAILURE.
 * A repo with nothing to watch and a repo whose glob missed everything look identical
 * from here.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WORKFLOW_DIR = '.github/workflows';
const HEALTH_LANE = 'ci-health-recovery.yml';
const HEALTH_REL = 'data/search_intelligence/automation_health.json';
const OUT_REL = 'artifacts/validation/ci-health-lane-coverage.json';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }

function workflowName(body) {
  const m = body.match(/^name:\s*(.+?)\s*$/m);
  return m ? m[1].replace(/^["']|["']$/g, '') : '';
}

/**
 * The workflow names the health lane subscribes to, list form or inline form.
 * Scoped to what follows `workflow_run:` so an unrelated `workflows:` key elsewhere
 * in the file cannot be mistaken for the subscription.
 */
function watchedWorkflows(body) {
  const at = body.indexOf('workflow_run:');
  if (at < 0) return [];
  const scope = body.slice(at);
  const inline = scope.match(/workflows:\s*\[([^\]]*)\]/);
  const listed = scope.match(/workflows:\s*\n((?:[ \t]*(?:#[^\n]*|-[ \t]*[^\n]+)\n)+)/);
  if (inline && (!listed || scope.indexOf(inline[0]) < scope.indexOf(listed[0]))) {
    return inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  if (!listed) return [];
  return listed[1].split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function main() {
  const errors = [];
  const dir = rel(WORKFLOW_DIR);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml')) : [];

  if (!files.length) {
    console.error(`CI HEALTH LANE COVERAGE FAIL: examined zero workflows under ${WORKFLOW_DIR}. Coverage is UNKNOWN, not proven.`);
    process.exit(1);
  }

  const byFile = new Map();
  for (const file of files) byFile.set(file, fs.readFileSync(path.join(dir, file), 'utf8'));

  const healthBody = byFile.get(HEALTH_LANE);
  if (!healthBody) {
    console.error(`CI HEALTH LANE COVERAGE FAIL: ${WORKFLOW_DIR}/${HEALTH_LANE} is missing, so nothing observes CI health at all.`);
    process.exit(1);
  }

  const namesByFile = new Map([...byFile].map(([file, body]) => [file, workflowName(body)]));
  const allNames = new Set([...namesByFile.values()].filter(Boolean));

  // A committing lane is one that actually pushes. That is the property that makes
  // going unwatched expensive, and it is read off the workflow rather than declared.
  const committing = [...byFile]
    .filter(([file, body]) => file !== HEALTH_LANE && /git push/.test(body))
    .map(([file]) => ({ file, name: namesByFile.get(file) || '' }));

  if (!committing.length) {
    console.error('CI HEALTH LANE COVERAGE FAIL: found zero workflows that push to main. Either the repo genuinely publishes nothing, or this check stopped reaching the workflows it governs; both are reported rather than passed.');
    process.exit(1);
  }

  const watched = watchedWorkflows(healthBody);
  if (!watched.length) {
    console.error(`CI HEALTH LANE COVERAGE FAIL: ${HEALTH_LANE} subscribes to zero workflows, so it observes nothing and can never raise an alert.`);
    process.exit(1);
  }
  const watchedSet = new Set(watched);

  for (const lane of committing) {
    if (!lane.name) { errors.push(`${lane.file}: pushes to main but declares no \`name:\`, so it cannot be watched by name.`); continue; }
    if (!watchedSet.has(lane.name)) errors.push(`${lane.file}: "${lane.name}" pushes to main but ${HEALTH_LANE} does not watch it. A red run there raises no alert.`);
  }
  if (!watchedSet.has('Validate Repo')) errors.push(`${HEALTH_LANE}: does not watch "Validate Repo", the validator that governs every committing lane.`);
  for (const name of watched) {
    if (!allNames.has(name)) errors.push(`${HEALTH_LANE}: watches "${name}", which matches no workflow's \`name:\`. A subscription to a name that does not exist observes nothing and reports nothing.`);
  }

  // The recorded health has to be internally consistent, and the rollup has to agree
  // with the lanes underneath it.
  const health = readJson(HEALTH_REL, null);
  const lanes = (health && health.lanes && typeof health.lanes === 'object') ? health.lanes : {};
  const laneRows = Object.entries(lanes);
  for (const [name, row] of laneRows) {
    if (row.state === 'RECOVERED') {
      if (!row.last_validated_sha) errors.push(`${HEALTH_REL}: lane "${name}" is RECOVERED with no last_validated_sha.`);
      if (row.failure_run_url) errors.push(`${HEALTH_REL}: lane "${name}" is RECOVERED but still points at a failure run.`);
    } else if (row.state === 'RED') {
      if (!row.last_failure_sha) errors.push(`${HEALTH_REL}: lane "${name}" is RED with no last_failure_sha.`);
    } else if (row.state !== 'UNPROVEN') {
      errors.push(`${HEALTH_REL}: lane "${name}" carries state "${row.state}", which no writer emits.`);
    }
  }
  if (health && laneRows.length) {
    const anyRed = laneRows.some(([, row]) => row.state === 'RED');
    const allRecovered = laneRows.every(([, row]) => row.state === 'RECOVERED');
    const expected = anyRed ? 'RED' : (allRecovered ? 'RECOVERED' : 'UNPROVEN');
    if (health.state !== expected) errors.push(`${HEALTH_REL}: rollup says ${health.state} over ${laneRows.length} lane(s), but the lanes say ${expected}. A summary that disagrees with its own rows is how a red lane hides.`);
  }

  const out = {
    schema_version: '1.0',
    validator: 'ci-health-lane-coverage',
    status: errors.length ? 'FAIL' : 'PASS',
    workflows_examined: files.length,
    committing_lanes: committing.map((l) => l.name || l.file).sort(),
    watched_workflows: [...watched].sort(),
    lanes_recorded: laneRows.length,
    lane_states: Object.fromEntries(laneRows.map(([n, r]) => [n, r.state])),
    rollup_state: health ? health.state : null,
    errors,
  };
  fs.mkdirSync(path.dirname(rel(OUT_REL)), { recursive: true });
  fs.writeFileSync(rel(OUT_REL), `${JSON.stringify(out, null, 2)}\n`, 'utf8');

  if (errors.length) {
    console.error(`CI HEALTH LANE COVERAGE FAIL: ${errors.length} problem(s).`);
    for (const line of errors.slice(0, 25)) console.error(`  ${line}`);
    process.exit(1);
  }
  console.log(`CI HEALTH LANE COVERAGE PASS: ${committing.length} committing lane(s) all watched by ${HEALTH_LANE}; ${watched.length} subscription(s) all resolve to a real workflow; ${laneRows.length} recorded lane(s) consistent with the ${out.rollup_state || 'unset'} rollup.`);
}

main();
