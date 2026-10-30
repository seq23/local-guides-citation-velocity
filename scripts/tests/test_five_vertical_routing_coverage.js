'use strict';
// Read-only regression contract for the five nationwide canonical destinations.
// Run: node scripts/tests/test_five_vertical_routing_coverage.js
const assert = require('node:assert/strict');
const { resolveCanonicalTarget, isLiveCanonicalRoute } = require('../lib/canonical_routes');

const cases = [
  { family: 'USCIS medical fee', host: 'uscisexam.com', hub: '/uscis-medical/', title: 'What will an immigration medical exam really cost?', cluster: 'cost-insurance', target: '/guides/uscis-medical-exam-cost/' },
  { family: 'USCIS lab-fee distinction', host: 'uscisexam.com', hub: '/uscis-medical/', title: 'Does the $750 immigration physical include blood tests?', cluster: 'cost-insurance', target: '/guides/uscis-medical-exam-cost/' },
  { family: 'Vitamin C injection vs TRT', host: 'hormonesivhair.com', hub: '/trt/', title: 'Is a vitamin C shot the same as a vitamin C IV?', cluster: 'cost-insurance', target: '/guides/iv-hydration-therapy-overview/' },
  { family: 'TRT delivery method', host: 'hormonesivhair.com', hub: '/trt/', title: 'TRT injections versus gels', cluster: 'cost-insurance', target: '/guides/trt-injections-vs-gels/' },
  { family: 'ADHD assessment vs component', host: 'neuroevalguides.com', hub: '/neuro/', title: 'What is the difference between an ADHD QbTest and a full evaluation?', cluster: 'situations', target: '/guides/adhd-evaluations-what-to-expect/' },
  { family: 'ADHD treatment after evaluation', host: 'neuroevalguides.com', hub: '/neuro/', title: 'Can an ADHD evaluation help with therapy planning?', cluster: 'therapy-after-evaluation', target: '/guides/how-to-find-an-adhd-therapist-who-fits/' },
  { family: 'Dental special scope', host: 'dentistryguides.com', hub: '/dentistry/', title: 'Does a $99 dental new patient special include a cleaning?', cluster: 'cost-financing', target: '/guides/cost-financing/' },
  { family: 'Crash records after accident', host: 'theaccidentguides.com', hub: '/personal-injury/', title: 'How do I request a police crash report after a collision?', cluster: 'situations', target: '/guides/car-accidents/' },
  { family: 'Attorney fee agreements', host: 'theaccidentguides.com', hub: '/personal-injury/', title: 'How do I compare lawyer contingency fees?', cluster: 'cost-fees', target: '/guides/personal-injury-fees-explained/' },
];
let failed = 0;
const coverage = [];
for (const row of cases) {
  const input = 'https://' + row.host + row.hub;
  const expected = 'https://' + row.host + row.target;
  let actual, status;
  try {
    actual = resolveCanonicalTarget(input, { title: row.title, cluster: row.cluster });
    assert.equal(actual, expected);
    assert.ok(isLiveCanonicalRoute(actual), 'target missing from canonical route snapshot');
    status = 'PASS';
  } catch (error) {
    failed++;
    status = 'FAIL';
    actual = actual || String(error.message);
  }
  coverage.push({ family: row.family, host: row.host, status, expected, actual });
}
console.log(JSON.stringify({ schema: 'five-vertical-routing-regression-v1', checked: coverage.length, passed: coverage.length - failed, failed, coverage }, null, 2));
if (failed) process.exitCode = 1;
