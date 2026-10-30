#!/usr/bin/env node
'use strict';
/**
 * Dispatch a workflow on a ref, retrying a transient GitHub failure (bounded).
 * Usage: node scripts/ci/dispatch_workflow.js <workflow-file> <ref>
 *
 * Use this instead of a bare `gh workflow run`: on 30 Oct 2026 one HTTP 500 on
 * that call turned a release that had already pushed into a red run, and
 * validation of the pushed tree never ran. See scripts/lib/github_write_retry.js.
 * A duplicate dispatch after a 500 that did land is harmless here. Both dispatch
 * targets are idempotent: validate-repo only reads, and the release lane re-walks
 * main under the shared main-writer concurrency group.
 */
const { withTransientRetry, githubRequest } = require('../lib/github_write_retry.js');

const [workflow, ref] = process.argv.slice(2);
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!workflow || !ref) { console.error('DISPATCH FAIL: usage: dispatch_workflow.js <workflow-file> <ref>'); process.exit(1); }
if (!token || !repo) { console.error(`DISPATCH FAIL: ${!token ? 'GH_TOKEN/GITHUB_TOKEN' : 'GITHUB_REPOSITORY'} is not set; refusing to report a dispatch that was never sent.`); process.exit(1); }

withTransientRetry(`dispatch ${workflow}@${ref}`, () => githubRequest(token, 'POST', `/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`, { ref }))
  .then(() => console.log(`DISPATCHED ${workflow} on ${ref}`))
  .catch((e) => { console.error(`DISPATCH FAIL: ${e.message}`); process.exit(1); });
