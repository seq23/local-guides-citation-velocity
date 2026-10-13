#!/usr/bin/env node
'use strict';
// Proves validate_canonical_vertical_ids.js passes a clean tree and fails each
// way it can break (the same cases the validator self-tests on every run), and
// that the emit-boundary helper resolves every alias to a canonical id.
const assert = require('assert');
const { selfTest } = require('../validators/validate_canonical_vertical_ids');
const { toCanonicalVertical, canonicalVerticalIds } = require('../lib/canonical_vertical');

const st = selfTest();
assert.deepStrictEqual(st.failures, [], st.failures.join('\n'));
assert.ok(st.cases >= 7, 'self-test must cover at least 7 cases');

assert.deepStrictEqual(canonicalVerticalIds().sort(), ['dentistry', 'neuro', 'personal-injury', 'senior-living', 'trt', 'uscis-medical']);
for (const [input, want] of [['pi', 'personal-injury'], ['personal_injury', 'personal-injury'], ['uscis', 'uscis-medical'], ['uscis_medical', 'uscis-medical'], ['senior_living', 'senior-living'], ['general', null], ['', null]]) {
  assert.strictEqual(toCanonicalVertical(input), want, `${input} -> ${want}`);
}
console.log(`canonical vertical ids: ${st.cases} validator cases + helper aliases pass`);
