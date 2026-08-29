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
 */
const L = require('./lib');
const https = require('https');

const conclusion = process.env.WORKFLOW_CONCLUSION || 'unknown';
const sha = process.env.WORKFLOW_HEAD_SHA || '';
const runUrl = process.env.WORKFLOW_RUN_URL || '';
const repo = process.env.GITHUB_REPOSITORY || '';
const token = process.env.GITHUB_TOKEN || '';

// Only an observed success is a recovery. 'unknown' (a manual dispatch that
// observed nothing) is neither a recovery nor a failure: it must not clear an
// alert, and it must not raise one either.
const OBSERVED_SUCCESS = conclusion === 'success';
const OBSERVED_FAILURE = conclusion !== 'success' && conclusion !== 'unknown';

const health = L.readJson('data/search_intelligence/automation_health.json', { schema_version: '1.0', state: 'UNPROVEN' });
health.observed_at = new Date().toISOString();
health.observed_conclusion = conclusion;

if (OBSERVED_SUCCESS) {
  health.state = 'RECOVERED';
  health.last_validated_sha = sha;
  health.last_recovery_sha = sha;
  // A recovery supersedes the failure it recovered from; leaving the old run
  // URL in place described a green state pointing at a red run.
  health.failure_run_url = null;
  health.recovery_run_url = runUrl;
} else if (OBSERVED_FAILURE) {
  health.state = 'RED';
  health.last_failure_sha = sha;
  health.failure_run_url = runUrl;
} else {
  // Nothing was observed. Say so and change no verdict.
  health.state = health.state || 'UNPROVEN';
  health.last_unobserved_at = health.observed_at;
}
L.writeJson('data/search_intelligence/automation_health.json', health);

if (!OBSERVED_SUCCESS && !OBSERVED_FAILURE) {
  console.log(`CI HEALTH NAMED STOP: conclusion "${conclusion}" observed no Validate Repo run (this is what a manual dispatch looks like). State left at ${health.state}; no alert opened, and no standing alert closed.`);
  process.exit(0);
}

if (!token || !repo) {
  console.log(`CI HEALTH ${health.state}: ${sha || 'NO_SHA'} (no GitHub mutation: token/repo unavailable)`);
  process.exit(0);
}

const [owner, name] = repo.split('/');
const title = '[Automation Health] Validate Repo CI RED';
const body = `Exact SHA: ${sha}\nConclusion: ${conclusion}\nRun: ${runUrl}\n\nThis issue is managed by the CI health recovery loop. A later green exact-SHA run may close it.`;

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
    console.log(`CI HEALTH RECOVERED ${sha}${issue ? ` (closed alert #${issue.number})` : ' (no standing alert)'}`);
    return;
  }
  if (issue) await request('PATCH', `/repos/${owner}/${name}/issues/${issue.number}`, { body });
  else await request('POST', `/repos/${owner}/${name}/issues`, { title, body, labels: ['automation-health'] });
  console.log(`CI HEALTH RED ${sha}`);
})().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
