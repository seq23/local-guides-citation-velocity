#!/usr/bin/env node
'use strict';
/**
 * Record exact-SHA CI health and open or close the governed alert.
 *
 * Three defects fixed here on 2026-08-29.
 *
 * 1. A manual dispatch silently closed a live RED alert. The workflow passed
 *    `github.event.workflow_run.conclusion || 'success'`, and a workflow_dispatch
 *    carries no workflow_run - so a human clicking "Run workflow" recorded
 *    RECOVERED and PATCHed the open issue closed with "Recovered on exact SHA "
 *    and an empty SHA. Nothing had been validated. The workflow now passes
 *    'unknown', and only an OBSERVED success may close an alert: anything else
 *    is reported and leaves the alert standing.
 *
 * 2. A RECOVERED record kept the previous failure's run URL, so the health file
 *    described a green state while still pointing at a red run. Recovery now
 *    clears the failure fields it supersedes.
 *
 * 3. The open-issue lookup fetched one unpaginated page of 50. Past 50 open
 *    labelled issues the existing alert is invisible and a duplicate is opened
 *    every run. It now follows pages until the alert is found or the list ends.
 *
 * On state naming: this writes 'RECOVERED' or 'RED', never 'GREEN'. Consumers
 * must match those two.
 *
 * 2026-09-06: it watched one workflow.
 *
 * Velocity Content Release - the repo's publishing surface - ran red on 2026-09-04,
 * 09-05 and twice on 09-06 and this lane reported SUCCESS straight through, because
 * `workflow_run.workflows` named only "Validate Repo" and Validate Repo was genuinely
 * green the whole time. Nothing was inert and no loop passed on empty: the lane
 * answered honestly about the one thing it could see, and a three-day outage on the
 * lane that publishes ran with no alert because it was never in frame. Four workflows
 * push to main and none of them was observed.
 *
 * Health is therefore per lane. `lanes` carries one record per observed workflow, each
 * with the state, SHA and run URL that workflow last proved for itself, and one lane's
 * red can no longer be overwritten by another lane's green. The top-level fields stay
 * and become the ROLLUP - RED if any watched lane is red, RECOVERED only when every
 * observed lane is - so existing consumers keep reading a true summary rather than the
 * last writer's opinion.
 *
 * Alerts are per lane too, titled by workflow. "[Automation Health] Validate Repo CI
 * RED" is unchanged, so a standing alert stays findable and closable.
 */
const L = require('./lib');
const https = require('https');

const conclusion = process.env.WORKFLOW_CONCLUSION || 'unknown';
const sha = process.env.WORKFLOW_HEAD_SHA || '';
const runUrl = process.env.WORKFLOW_RUN_URL || '';
const repo = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GITHUB_TOKEN || '';
// Which lane this observation is about. A dispatch observes no workflow_run at all,
// so it names no lane and may not move any lane's verdict.
const lane = (process.env.WORKFLOW_NAME || '').trim();

// Only an observed success is a recovery. 'unknown' (a manual dispatch that
// observed nothing) is neither a recovery nor a failure: it must not clear an
// alert, and it must not raise one either.
const OBSERVED_SUCCESS = conclusion === 'success';
const OBSERVED_FAILURE = conclusion !== 'success' && conclusion !== 'unknown';
const OBSERVED = OBSERVED_SUCCESS || OBSERVED_FAILURE;

const health = L.readJson('data/search_intelligence/automation_health.json', { schema_version: '1.1', state: 'UNPROVEN' });
if (!health.lanes || typeof health.lanes !== 'object') health.lanes = {};
health.schema_version = '1.1';
health.observed_at = new Date().toISOString();
health.observed_conclusion = conclusion;
health.observed_workflow = lane;

if (OBSERVED && lane) {
  const record = health.lanes[lane] || { state: 'UNPROVEN' };
  record.workflow = lane;
  record.observed_at = health.observed_at;
  record.observed_conclusion = conclusion;
  if (OBSERVED_SUCCESS) {
    record.state = 'RECOVERED';
    record.last_validated_sha = sha;
    record.last_recovery_sha = sha;
    // A recovery supersedes the failure it recovered from; leaving the old run
    // URL in place described a green state pointing at a red run.
    record.failure_run_url = null;
    record.recovery_run_url = runUrl;
  } else {
    record.state = 'RED';
    record.last_failure_sha = sha;
    record.failure_run_url = runUrl;
  }
  health.lanes[lane] = record;
} else if (!OBSERVED) {
  health.last_unobserved_at = health.observed_at;
}

/**
 * The rollup, recomputed from the lanes every time.
 *
 * Any lane red makes the summary red - a green publishing lane cannot be used to
 * describe a repo whose validator is failing, and a green validator cannot be used to
 * describe a repo whose publishing lane has been red for three days, which is exactly
 * what happened. RECOVERED requires every observed lane to be recovered; anything else
 * is UNPROVEN, which is what "we have not seen enough to say" should look like.
 */
const laneRecords = Object.values(health.lanes);
const red = laneRecords.filter((r) => r.state === 'RED');
const recovered = laneRecords.filter((r) => r.state === 'RECOVERED');
if (red.length) {
  const worst = red.reduce((a, b) => (String(a.observed_at || '') >= String(b.observed_at || '') ? a : b));
  health.state = 'RED';
  health.last_failure_sha = worst.last_failure_sha || null;
  health.failure_run_url = worst.failure_run_url || null;
  health.red_lanes = red.map((r) => r.workflow).sort();
} else if (laneRecords.length && recovered.length === laneRecords.length) {
  const newest = recovered.reduce((a, b) => (String(a.observed_at || '') >= String(b.observed_at || '') ? a : b));
  health.state = 'RECOVERED';
  health.last_validated_sha = newest.last_validated_sha || null;
  health.last_recovery_sha = newest.last_recovery_sha || null;
  health.recovery_run_url = newest.recovery_run_url || null;
  health.failure_run_url = null;
  health.red_lanes = [];
} else {
  health.state = 'UNPROVEN';
  health.red_lanes = [];
}
health.lanes_observed = laneRecords.length;
health.truth_rule = 'CI health changes only from observed exact-SHA workflow results, recorded per lane. The top-level state is a rollup: RED if any lane is red, RECOVERED only when every observed lane is.';
L.writeJson('data/search_intelligence/automation_health.json', health);

if (!OBSERVED) {
  console.log(`CI HEALTH NAMED STOP: conclusion "${conclusion}" observed no workflow_run (this is what a manual dispatch looks like). Rollup left at ${health.state} over ${laneRecords.length} lane(s); no alert opened, and no standing alert closed.`);
  process.exit(0);
}
if (!lane) {
  console.error('CI HEALTH FAIL: a workflow_run was observed but WORKFLOW_NAME is empty, so the result cannot be attributed to a lane. Refusing to record an unattributed verdict.');
  process.exit(1);
}

if (!token || !repo) {
  console.log(`CI HEALTH ${health.lanes[lane].state} [${lane}]: ${sha || 'NO_SHA'} (no GitHub mutation: token/repo unavailable)`);
  process.exit(0);
}

const [owner, name] = repo.split('/');
const title = `[Automation Health] ${lane} CI RED`;
const body = `Workflow: ${lane}\nExact SHA: ${sha}\nConclusion: ${conclusion}\nRun: ${runUrl}\n\nThis issue is managed by the CI health recovery loop. A later green exact-SHA run of this same workflow may close it.`;

function request(method, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const data = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const req = https.request({
      hostname: 'api.github.com', path: urlPath, method,
      headers: {
        'User-Agent': 'local-guides-ci-health',
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {})
      }
    }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(s ? JSON.parse(s) : {});
        else reject(new Error(`${method} ${urlPath} -> ${res.statusCode}: ${s.slice(0, 500)}`));
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Follow pages. A single unpaginated page of 50 meant that past 50 open
// labelled issues the standing alert became invisible and a duplicate was
// opened on every red run.
async function findAlert() {
  for (let page = 1; page <= 20; page += 1) {
    const issues = await request('GET', `/repos/${owner}/${name}/issues?state=open&labels=automation-health&per_page=100&page=${page}`);
    if (!Array.isArray(issues) || issues.length === 0) return null;
    const hit = issues.find((x) => x.title === title);
    if (hit) return hit;
    if (issues.length < 100) return null;
  }
  return null;
}

(async () => {
  const issue = await findAlert();
  if (OBSERVED_SUCCESS) {
    if (issue) await request('PATCH', `/repos/${owner}/${name}/issues/${issue.number}`, { state: 'closed', body: `Recovered on exact SHA ${sha}.\nRun: ${runUrl}` });
    console.log(`CI HEALTH RECOVERED [${lane}] ${sha}${issue ? ` (closed alert #${issue.number})` : ' (no standing alert)'}`);
    return;
  }
  if (issue) await request('PATCH', `/repos/${owner}/${name}/issues/${issue.number}`, { body });
  else await request('POST', `/repos/${owner}/${name}/issues`, { title, body, labels: ['automation-health'] });
  console.log(`CI HEALTH RED [${lane}] ${sha}`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
