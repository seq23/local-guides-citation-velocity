#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }
function writeReport(name, report) { fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'artifacts/validation', name), JSON.stringify(report, null, 2) + '\n'); }
function fail(errors, name, extra = {}) { const report = { validator: name.replace(/\.json$/, ''), ok: errors.length === 0, errors, ...extra }; writeReport(name, report); if (errors.length) { console.error(errors.join('\n')); process.exit(1); } console.log(`${report.validator} PASS`); }

const errors = [];
const profile = exists('data/strategy/citation_strategy_profile.json') ? readJson('data/strategy/citation_strategy_profile.json') : {};
const contract = exists('_content_release_contract.json') ? readJson('_content_release_contract.json') : {};
if (profile.structural_graph_live_policy !== 'preserve_all_staged_structural_pages_live_when_graph_critical') errors.push('profile structural graph policy mismatch');
if (!String(contract.structural_graph_live_policy || '').includes('staged structural pages remain live')) errors.push('content release contract missing structural graph policy');
for (const rel of ['atlas/index.html', 'sitemap.xml', 'llms.txt']) if (!exists(rel)) errors.push(`missing graph artifact:${rel}`);
const forbidden = contract.forbidden_runtime_mutations || [];
for (const rel of ['.github/**', 'package.json', 'scripts/**', 'docs/**']) if (!forbidden.includes(rel)) errors.push(`missing forbidden runtime mutation:${rel}`);
fail(errors, 'structural-graph-live-policy.json', { policy: profile.structural_graph_live_policy || null });
