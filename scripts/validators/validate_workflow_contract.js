#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '../..');
const dir = path.join(ROOT, '.github/workflows');
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).sort();
const errors = [];
const fingerprints = [];
const required = ['daily-citation-intelligence.yml','validate-repo.yml','velocity-content-release.yml','velocity-full-rebuild.yml','deploy-distribution.yml'];
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  fingerprints.push({file: f, sha256: crypto.createHash('sha256').update(text).digest('hex')});
  // Require a pinned major version rather than one specific version. Asserting v4
  // exactly meant the deprecated Node 20 actions could never be upgraded without
  // failing this contract. Floating refs (@main, @master) are still rejected.
  if (/actions\/checkout@(?!v\d+)/.test(text)) errors.push(`${f}:checkout-version`);
  if (/actions\/setup-node@(?!v\d+)/.test(text)) errors.push(`${f}:setup-node-version`);
  const versions = [...text.matchAll(/node-version:\s*["']?([^"'\s#]+)/g)].map((m) => m[1]);
  if (!versions.length || versions.some((v) => !/^24(?:\.|$)/.test(v))) errors.push(`${f}:node-version`);
  if (/create-pull-request|LKG_REPO|LKG_TOKEN|lkg:candidates/i.test(text)) errors.push(`${f}:cross-repo-lkg-surface`);
  if (!/NODE_OPTIONS:\s*--max-old-space-size=3072/.test(text)) errors.push(`${f}:node-options`);
  // EVERY JOB CARRIES ITS OWN CEILING. A job with no timeout-minutes inherits the
  // platform's 360, so a hung step is watched for six hours instead of being
  // cancelled at ~2x its normal duration and investigated (the standing CI shape,
  // 21 Sep 2026). Jobs are the two-space-indented keys under `jobs:`.
  const jobsBlock = text.split(/^jobs:\s*$/m)[1] || '';
  const jobNames = [...jobsBlock.matchAll(/^  ([A-Za-z_][\w-]*):\s*$/gm)].map((m) => m[1]);
  if (!jobNames.length) errors.push(`${f}:no-jobs-parsed`);
  for (const job of jobNames) {
    const body = jobsBlock.split(new RegExp(`^  ${job}:\\s*$`, 'm'))[1]?.split(/^  [A-Za-z_][\w-]*:\s*$/m)[0] || '';
    if (!/^    timeout-minutes:\s*\d+/m.test(body)) errors.push(`${f}:job-without-timeout:${job}`);
  }
}
// THE MERGE GATE IS SHARDED, AND THE COUNT IS ONE NUMBER. validate-repo.yml declares
// SHARD_COUNT once and a matrix that must be exactly [0..N-1]; each shard job passes
// VALIDATION_SHARD=<i>/<N> and the aggregate passes VALIDATION_MERGE_SHARDS=<N> into
// release:ci-validate. A matrix that drifts from the count is a slice of the release
// profile that never runs (merge_validation_shards.js would fail the aggregate, but
// this names it on the workflow edit itself).
{
  const validateText = fs.readFileSync(path.join(dir, 'validate-repo.yml'), 'utf8');
  const count = Number((validateText.match(/^\s*SHARD_COUNT:\s*["']?(\d+)["']?\s*$/m) || [])[1]);
  const matrix = (validateText.match(/^\s*shard:\s*\[([^\]]*)\]/m) || [])[1];
  if (!(count >= 2)) errors.push('validate-repo:shard-count-missing-or-below-2');
  else {
    const expected = Array.from({ length: count }, (_, i) => String(i)).join(',');
    const found = String(matrix || '').split(',').map((v) => v.trim()).filter(Boolean).join(',');
    if (found !== expected) errors.push(`validate-repo:shard-matrix-mismatch:expected [${expected}] found [${found}]`);
  }
  if (!/VALIDATION_SHARD:\s*\$\{\{\s*matrix\.shard\s*\}\}\/\$\{\{\s*env\.SHARD_COUNT\s*\}\}/.test(validateText)) errors.push('validate-repo:shard-env-not-wired');
  if (!/VALIDATION_MERGE_SHARDS:\s*\$\{\{\s*env\.SHARD_COUNT\s*\}\}/.test(validateText)) errors.push('validate-repo:merge-env-not-wired');
  if (!/needs:\s*shard/.test(validateText)) errors.push('validate-repo:aggregate-does-not-need-shards');
  if (!/pattern:\s*validation-shard-\*-\$\{\{\s*github\.run_id\s*\}\}/.test(validateText)) errors.push('validate-repo:aggregate-does-not-download-this-runs-shards');
}
for (const f of required) if (!files.includes(f)) errors.push(`missing:${f}`);
// postdeploy-public-audit.yml joined this list on 2026-08-29: the postdeploy
// click-audit lane was removed by owner decision, so its presence is now a failure.
for (const retired of ['validate.yml','velocity_content_release.yml','velocity_full_rebuild.yml','release_batch.yml','postdeploy_public_audit.yml','postdeploy-public-audit.yml']) if (files.includes(retired)) errors.push(`retired-present:${retired}`);
const content = fs.readFileSync(path.join(dir, 'velocity-content-release.yml'), 'utf8');
const validate = fs.readFileSync(path.join(dir, 'validate-repo.yml'), 'utf8');
const dist = fs.readFileSync(path.join(dir, 'deploy-distribution.yml'), 'utf8');
const daily = fs.readFileSync(path.join(dir, 'daily-citation-intelligence.yml'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const releaseIntake = String((pkg.scripts || {})['release:velocity-intake'] || '');
if (!/release:velocity-intake/.test(content) || !/git push origin HEAD:main/.test(content)) errors.push('velocity-content-release:not-autonomous');
if (!/data\/report_fixes\/agent_runs\/\*\*/.test(content)) errors.push('velocity-content-release:agent-run-path-trigger-missing');
if (!/release:daily-citation-intelligence:preview/.test(content)) errors.push('velocity-content-release:missing-traffic-qualified-preview');
if (!/citation:apply-html-report-contract/.test(releaseIntake)) errors.push('release:velocity-intake:missing-html-report-contract-apply');
if (!/validate:html-report-contract/.test(releaseIntake)) errors.push('release:velocity-intake:missing-html-report-contract-validation');
if (!/release:ci-validate/.test(validate)) errors.push('validate-repo:central-command');
if (!/include-hidden-files:\s*true/.test(validate)) errors.push('validate-repo:validated-artifact-must-include-hidden-files');
if (/npm run build|distribution:prepare/.test(dist)) errors.push('deploy-distribution:must-not-rebuild');
if (!/download-artifact@v\d+/.test(dist)) errors.push('deploy-distribution:download-validated-artifact');
if (!/run-id:\s*\$\{\{ steps\.artifact\.outputs\.run_id \}\}/.test(dist)) errors.push('deploy-distribution:must-download-exact-run-id');
if (!/node scripts\/prepare_distribution_from_attestation\.js/.test(dist)) errors.push('deploy-distribution:must-verify-attestation-before-deploy');
if (!/release:daily-citation-intelligence/.test(daily) || !/cron:\s*"17 13 \* \* \*"/.test(daily)) errors.push('daily-citation-intelligence:command-or-cron-missing');
const report = {validator: 'workflow-contract', ok: !errors.length, errors, fingerprints};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/workflow.json'), JSON.stringify(report, null, 2) + '\n');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('VELOCITY WORKFLOW CONTRACT PASS');
