#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function writeReport(name, report) { fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'artifacts/validation', name), JSON.stringify(report, null, 2) + '\n'); }
function finish(errors, name, extra = {}) { const report = { validator: name.replace(/\.json$/, ''), ok: errors.length === 0, errors, ...extra }; writeReport(name, report); if (errors.length) { console.error(errors.join('\n')); process.exit(1); } console.log(`${report.validator} PASS`); }

const errors = [];
const inventory = exists('artifacts/validation/workflow-yaml-inventory.json') ? readJson('artifacts/validation/workflow-yaml-inventory.json') : { workflows: [] };
const allowed = new Set(inventory.canonical_lanes || []);
const laneCounts = {};
for (const w of inventory.workflows || []) {
  if (!allowed.has(w.repo_lane)) errors.push(`unmapped lane:${w.path}:${w.repo_lane}`);
  laneCounts[w.repo_lane] = (laneCounts[w.repo_lane] || 0) + 1;
}
for (const lane of ['validate','content-release','signal-intelligence','deploy','full-rebuild']) if (!laneCounts[lane]) errors.push(`missing canonical lane:${lane}`);
// Retired lanes: assert absence, not presence. `postdeploy-audit` was removed
// 2026-08-29 by owner decision; the click-audit runner survives as the local
// browser proof (release:prepush:local), only the deployed lane is gone. Each
// entry must stay absent from the live topology AND stay recorded as retired,
// so the retirement cannot be silently undone in either direction.
const retiredPaths = new Set((inventory.retired_or_replaced_workflows || []).filter((r) => r.action === 'DELETE').map((r) => r.path));
for (const [lane, workflowPath] of [['postdeploy-audit', '.github/workflows/postdeploy-public-audit.yml']]) {
  if (laneCounts[lane]) errors.push(`retired lane still present:${lane}`);
  if (allowed.has(lane)) errors.push(`retired lane still listed as canonical:${lane}`);
  if (!retiredPaths.has(workflowPath)) errors.push(`retired lane not recorded as DELETE in inventory:${workflowPath}`);
  if (exists(workflowPath)) errors.push(`retired workflow file still on disk:${workflowPath}`);
}
for (const w of inventory.workflows || []) {
  if (w.path.includes('_')) errors.push(`workflow filename not canonical hyphenated:${w.path}`);
  if (w.path.endsWith('release_batch.yml')) errors.push('release_batch.yml should be retired/merged');
}
const daily = inventory.workflows.find((w) => w.path.endsWith('daily-citation-intelligence.yml'));
if (!daily || !daily.trigger.includes('schedule') || !daily.trigger.includes('workflow_dispatch')) errors.push('daily citation workflow must have schedule and manual dispatch after structural proof');
finish(errors, 'workflow-topology.json', { lane_counts: laneCounts });
