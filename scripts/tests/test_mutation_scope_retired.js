#!/usr/bin/env node
'use strict';
// A thawed route the search rescue has since retired (not admitted, 301) is put
// back as frozen and reported; it never ends the release. Velocity Content
// Release threw "Cannot freeze non-admitted route: /uscis-medical/civil-surgeon-near-me/"
// on every run from 3 Nov 2026. An admitted route in the same scope is still accepted.
// The test restores every file it touches.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const ROOT = path.resolve(__dirname, '../..');
const fp = require('../lib/frozen_pages.js');
const touched = ['data/release/frozen_page_registry.json', 'data/release/active_mutation_scope.json', 'artifacts/validation/mutation-scope-acceptance.json'];
const saved = new Map(touched.map((rel) => [rel, fs.existsSync(path.join(ROOT, rel)) ? fs.readFileSync(path.join(ROOT, rel)) : null]));
const admitted = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'data/content/page_admission_registry.json'), 'utf8')).pages.map((p) => p.path));
const frozen = fp.loadRegistry().pages.filter((p) => p.state === 'FROZEN');
const retiredRoute = (frozen.find((p) => !admitted.has(p.route)) || {}).route;
const liveRoute = (frozen.find((p) => admitted.has(p.route)) || {}).route;
try {
  assert.ok(retiredRoute && liveRoute, 'needs one frozen retired route and one frozen admitted route');
  fp.beginMutationScope([retiredRoute, liveRoute], 'test-retired');
  const r = fp.acceptMutationScope();
  assert.deepEqual(r.routes, [liveRoute], 'the admitted route is accepted');
  assert.deepEqual((r.retired || []).map((x) => x.route), [retiredRoute], 'the retired route is reported, not accepted');
  const rec = fp.loadRegistry().pages.find((p) => p.route === retiredRoute);
  assert.equal(rec.state, 'FROZEN'); assert.equal(rec.transaction, null);
  console.log(`test:mutation-scope-retired OK: ${retiredRoute} restored as frozen; ${liveRoute} accepted`);
} finally {
  for (const [rel, buf] of saved) { const abs = path.join(ROOT, rel); if (buf === null) fs.rmSync(abs, { force: true }); else fs.writeFileSync(abs, buf); }
}
