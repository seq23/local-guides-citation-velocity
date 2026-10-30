'use strict';
/**
 * GitHub API writes in automation retry a transient failure (bounded), then fail
 * with a named error. Read here rather than trusted.
 *
 * 30 Oct 2026: one GitHub HTTP 500 on a bare `gh workflow run` left Velocity
 * Content Release red after it had already pushed (run 41069439670). A second 500
 * on POST /issues then left CI Health Red Recovery red (run 41071294097).
 *
 *   1. No workflow runs a bare `gh workflow run` / `gh issue create|edit|close|comment`
 *      on an executable line. Dispatches go through scripts/ci/dispatch_workflow.js.
 *      The workflows are DISCOVERED from .github/workflows, never listed by hand, and
 *      finding zero dispatch sites fails (this check would have examined nothing).
 *   2. ci_health_alert.js writes only through ci_health_issue.js and has no raw
 *      https.request of its own. ci_health_issue.js re-reads the alert inside the
 *      retried attempt, so a retry after a 500 that did land cannot open a duplicate.
 *   3. Behaviour (stubbed transport) is pinned in scripts/tests/test_github_write_retry.js,
 *      which site-hygiene runs and counts.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_DIR = '.github/workflows';
const DISPATCHER = 'scripts/ci/dispatch_workflow.js';
const ALERT = 'scripts/search_intelligence/ci_health_alert.js';
const ISSUE = 'scripts/search_intelligence/ci_health_issue.js';
const HELPER = 'scripts/lib/github_write_retry.js';
const BARE = /^\s*(?:-\s*)?(?:run:\s*)?gh\s+(?:workflow\s+run|issue\s+(?:create|edit|close|comment))\b/;

const repoIo = {
  read: (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8'),
  exists: (rel) => fs.existsSync(path.join(ROOT, rel)),
  list: (rel) => fs.readdirSync(path.join(ROOT, rel)).filter((n) => /\.ya?ml$/.test(n)).map((n) => `${rel}/${n}`),
};

function check(io = repoIo) {
  const failures = [];
  const read = (rel) => { try { return io.exists(rel) ? io.read(rel) : null; } catch { return null; } };
  let files = [];
  try { files = io.list(WORKFLOW_DIR); } catch { files = []; }
  let sites = 0;
  for (const rel of files) {
    const text = read(rel) || '';
    text.split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      if (BARE.test(line)) failures.push(`${rel}:${i + 1} runs a bare GitHub write (${line.trim().slice(0, 80)}); one transient 5xx turns the lane red. Use node ${DISPATCHER}`);
      if (line.includes(`node ${DISPATCHER} `)) sites += 1;
    });
  }
  if (!files.length || !sites) failures.push(`found ${files.length} workflows and ${sites} dispatch sites through ${DISPATCHER}; this check examined nothing`);

  for (const rel of [DISPATCHER, HELPER]) if (read(rel) === null) failures.push(`${rel} is missing`);
  const helper = read(HELPER);
  if (helper !== null && !/function withTransientRetry/.test(helper)) failures.push(`${HELPER} lost withTransientRetry`);
  const disp = read(DISPATCHER);
  if (disp !== null && !disp.includes('withTransientRetry(')) failures.push(`${DISPATCHER} no longer retries through withTransientRetry`);
  const alert = read(ALERT);
  if (alert === null) failures.push(`${ALERT} is missing`);
  else {
    if (!alert.includes("require('./ci_health_issue.js')")) failures.push(`${ALERT} no longer writes through ci_health_issue.js`);
    if (/https\.request\(/.test(alert)) failures.push(`${ALERT} makes a raw https.request; GitHub writes must go through the retried path`);
  }
  const issue = read(ISSUE);
  if (issue === null) failures.push(`${ISSUE} is missing`);
  else {
    const m = issue.match(/withTransientRetry\([\s\S]*?\n {2}\}, retryOpts\)/);
    if (!m) failures.push(`${ISSUE} no longer wraps the alert sync in withTransientRetry`);
    else if (!m[0].includes('await findAlert(')) failures.push(`${ISSUE} no longer re-reads the alert inside each retried attempt; a retry after a 500 that landed would open a duplicate`);
  }
  return { failures, stats: { workflows: files.length, dispatch_sites: sites } };
}

function selfTest() {
  const base = repoIo;
  const mk = (ov, list = base.list) => ({
    list,
    exists: (rel) => (rel in ov ? ov[rel] !== null : base.exists(rel)),
    read: (rel) => (rel in ov ? (ov[rel] === null ? (() => { throw new Error('missing'); })() : ov[rel]) : base.read(rel)),
  });
  const vcr = `${WORKFLOW_DIR}/velocity-content-release.yml`;
  const qer = `${WORKFLOW_DIR}/query-evidence-refresh.yml`;
  const cases = [
    ['the release lane goes back to a bare gh workflow run', { [vcr]: base.read(vcr).replace('node scripts/ci/dispatch_workflow.js validate-repo.yml main', 'gh workflow run validate-repo.yml --ref main') }],
    ['the evidence lane goes back to a bare gh workflow run', { [qer]: base.read(qer).replace('node scripts/ci/dispatch_workflow.js velocity-content-release.yml main', 'gh workflow run velocity-content-release.yml --ref main') }],
    ['a workflow opens an issue with bare gh issue create', { [vcr]: `${base.read(vcr)}\n      - run: gh issue create --title x --body y\n` }],
    ['the dispatcher stops retrying', { [DISPATCHER]: base.read(DISPATCHER).split('withTransientRetry(').join('noRetry(') }],
    ['the alert script makes its own raw request again', { [ALERT]: `${base.read(ALERT)}\nhttps.request({});\n` }],
    ['the alert script stops using the retried sync', { [ALERT]: base.read(ALERT).split("require('./ci_health_issue.js')").join("require('./elsewhere.js')") }],
    ['the alert sync stops re-reading inside the retry', { [ISSUE]: base.read(ISSUE).replace('const issue = await findAlert(request, owner, name, title);', 'const issue = cached;') }],
    ['the alert sync drops the retry', { [ISSUE]: base.read(ISSUE).split('withTransientRetry(').join('once(') }],
    ['the helper file is deleted', { [HELPER]: null }],
  ];
  const missed = [];
  for (const [name, ov] of cases) if (!check(mk(ov)).failures.length) missed.push(name);
  if (!check(mk({}, () => [])).failures.some((f) => f.includes('examined nothing'))) missed.push('workflow discovery that finds nothing');
  return { cases: cases.length + 1, missed };
}

module.exports = { check, selfTest, repoIo };
