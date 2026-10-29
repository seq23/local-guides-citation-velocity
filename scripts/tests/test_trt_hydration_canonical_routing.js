'use strict';

const assert = require('node:assert/strict');
const { resolveCanonicalTarget } = require('../lib/canonical_routes');

const generatedHub = 'https://hormonesivhair.com/trt/';
const route = (title) => resolveCanonicalTarget(generatedHub, { title, cluster: 'cost-insurance' });

assert.equal(
  route('How much does a vitamin C injection cost?'),
  'https://hormonesivhair.com/guides/iv-hydration-therapy-overview/'
);
assert.equal(
  route('Is an IV drip different from oral hydration?'),
  'https://hormonesivhair.com/guides/iv-hydration-therapy-overview/'
);
assert.equal(
  route('TRT injections vs gels: what changes?'),
  'https://hormonesivhair.com/guides/trt-injections-vs-gels/'
);
assert.equal(
  route('Testosterone therapy pricing and labs'),
  'https://hormonesivhair.com/guides/trt-pricing-and-labs/'
);

process.stdout.write('TRT hydration canonical routing PASS\n');
