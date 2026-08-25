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
const required = ['daily-citation-intelligence.yml','validate-repo.yml','velocity-content-release.yml','velocity-full-rebuild.yml','deploy-distribution.yml','postdeploy-public-audit.yml'];
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
}
for (const f of required) if (!files.includes(f)) errors.push(`missing:${f}`);
for (const retired of ['validate.yml','velocity_content_release.yml','velocity_full_rebuild.yml','release_batch.yml','postdeploy_public_audit.yml']) if (files.includes(retired)) errors.push(`retired-present:${retired}`);
const content = fs.readFileSync(path.join(dir, 'velocity-content-release.yml'), 'utf8');
const validate = fs.readFileSync(path.join(dir, 'validate-repo.yml'), 'utf8');
const dist = fs.readFileSync(path.join(dir, 'deploy-distribution.yml'), 'utf8');
const post = fs.readFileSync(path.join(dir, 'postdeploy-public-audit.yml'), 'utf8');
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
if (!/PLAYWRIGHT_BASE_URL/.test(post) || !/playwright@1\.61\.1/.test(post) || !/postdeploy:public-click-audit/.test(post)) errors.push('postdeploy-public-audit:real-browser-contract-missing');
if (!/release:daily-citation-intelligence/.test(daily) || !/cron:\s*"17 13 \* \* \*"/.test(daily)) errors.push('daily-citation-intelligence:command-or-cron-missing');
const report = {validator: 'workflow-contract', ok: !errors.length, errors, fingerprints};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/workflow.json'), JSON.stringify(report, null, 2) + '\n');
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('VELOCITY WORKFLOW CONTRACT PASS');
