#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');

const root = process.cwd();
const failures = [];
const warnings = [];
function read(rel) { return fs.existsSync(path.join(root, rel)) ? fs.readFileSync(path.join(root, rel), 'utf8') : ''; }
function exists(rel) { return fs.existsSync(path.join(root, rel)); }
function fail(msg) { failures.push(msg); }
function warn(msg) { warnings.push(msg); }
function includes(haystack, needle, label) { if (!haystack.includes(needle)) fail(`${label} missing ${needle}`); }

const workflowPath = '.github/workflows/deploy-distribution.yml';
const dailyPath = '.github/workflows/daily_release.yml';
const deployScriptPath = 'distribution_scripts/deploy_distribution.sh';
const submitScriptPath = 'distribution_scripts/indexnow_submit.sh';
const packagePath = 'package.json';

for (const rel of [workflowPath, dailyPath, deployScriptPath, submitScriptPath, packagePath]) {
  if (!exists(rel)) fail(`missing required file: ${rel}`);
}

const workflow = read(workflowPath);
const daily = read(dailyPath);
const deploy = read(deployScriptPath);
const submit = read(submitScriptPath);
let pkg = {};
try { pkg = JSON.parse(read(packagePath)); } catch { fail('package.json is not valid JSON'); }

if (workflow) {
  if (!/on:\s*[\s\S]*push:\s*[\s\S]*branches:\s*\[main\]/m.test(workflow) && !/branches:\s*\n\s*-\s*main/m.test(workflow)) {
    fail('deploy-distribution workflow must run on push to main');
  }
  includes(workflow, 'npm run distribution:prepare', workflowPath);
  includes(workflow, 'npm run validate:indexnow-workflow', workflowPath);
  includes(workflow, 'distribution_scripts/deploy_distribution.sh', workflowPath);
  includes(workflow, 'INDEXNOW_KEY: ${{ secrets.INDEXNOW_KEY }}', workflowPath);
  includes(workflow, 'reports/indexnow-submit-report.json', workflowPath);
  includes(workflow, 'actions/upload-artifact', workflowPath);
  const hasGscServiceAccountFile = workflow.includes('gsc-service-account.json');
  const hasSafeGscGate =
    workflow.includes('GSC_SERVICE_ACCOUNT_JSON_PRESENT') ||
    workflow.includes('if: ${{ secrets.GSC_SERVICE_ACCOUNT_JSON');

  if (!hasGscServiceAccountFile || !hasSafeGscGate) {
    warn('GSC service account is not clearly optional/gated in workflow');
  }
}

if (daily) {
  if (/INDEXNOW_MODE\s*:\s*["']?delta/i.test(daily) || /scripts\/indexnow_submit\.js/.test(daily)) {
    fail('daily_release.yml must not submit IndexNow before commit/push/deploy; deploy-distribution is the single authority');
  }
}

if (deploy) {
  includes(deploy, 'Submit IndexNow priority URLs', deployScriptPath);
  includes(deploy, 'Submit IndexNow batch URLs', deployScriptPath);
  includes(deploy, 'reports/indexnow-submit-report.json', deployScriptPath);
  includes(deploy, 'reports/indexnow-priority-submit-report.json', deployScriptPath);
  includes(deploy, 'reports/indexnow-batch-submit-report.json', deployScriptPath);
  if (deploy.indexOf('Submit IndexNow priority URLs') > deploy.indexOf('Submit Google sitemaps')) {
    fail('IndexNow must run before GSC so missing/broken GSC cannot block URL pings');
  }
  if (!deploy.includes('GSC skipped') || !deploy.includes('IndexNow was still attempted')) {
    fail('deploy script must clearly skip optional GSC without blocking IndexNow');
  }
}

if (submit) {
  includes(submit, 'INDEXNOW_DRY_RUN', submitScriptPath);
  includes(submit, 'INDEXNOW_REPORT_FILE', submitScriptPath);
  includes(submit, 'https://api.indexnow.org/indexnow', submitScriptPath);
  includes(submit, 'reports/indexnow-submit-report.json', submitScriptPath);
  includes(submit, 'keyFilePresent', submitScriptPath);
  if (!submit.includes('Warn-only') && !submit.includes('Warn-only for remote/network failures')) {
    warn('submit script should document network failures as warn-only');
  }
}

if (pkg.scripts) {
  if (pkg.scripts['validate:indexnow-workflow'] !== 'node scripts/validators/validate_indexnow_workflow.js') {
    fail('package.json missing validate:indexnow-workflow script');
  }
  if (!String(pkg.scripts['validate:all'] || '').includes('validate:indexnow-workflow')) {
    fail('validate:all must include validate:indexnow-workflow');
  }
} else {
  fail('package.json missing scripts block');
}

const report = {
  repo: 'local-guides-citation-velocity',
  checkedAt: new Date().toISOString(),
  status: failures.length ? 'failed' : 'passed',
  failures,
  warnings,
  runtimeReportPresent: exists('reports/indexnow-submit-report.json'),
};
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports', 'validate_indexnow_workflow.json'), JSON.stringify(report, null, 2) + '\n');

if (failures.length) {
  console.error('IndexNow workflow contract FAIL');
  failures.forEach((f) => console.error(`- ${f}`));
  process.exit(1);
}
console.log('IndexNow workflow contract PASS');
if (warnings.length) warnings.forEach((w) => console.log(`WARNING: ${w}`));
