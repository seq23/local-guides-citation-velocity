'use strict';
const assert = require('node:assert/strict');
const rescue = require('../lib/search_rescue');
const { shape } = require('../lib/rescue_page_shape');
const kept = new Set(rescue.policy.kept.map(p => p.path));
assert.ok(kept.size > 0 && kept.size <= 300);
for (const row of rescue.policy.retirements) {
  assert.ok(kept.has(row.target_path));
  assert.ok(!rescue.allowed(row.source_path));
  assert.equal(rescue.target(row.source_path), row.target_path);
}
assert.equal(rescue.allowed('/questions/unreviewed-new-page/'), false);
const { inventoryCoverage } = require('../lib/public_inventory_coverage');
const coverageFixture = { admitted: ['/hub/'], rendered: ['/hub/'], retirements: [{ source_path: '/old/', target_path: '/hub/', status: 'ACTIVE_301' }], redirects: [['/old/', '/hub/', '301']], minimum: 2 };
assert.deepEqual(inventoryCoverage(coverageFixture).issues, []);
assert.ok(inventoryCoverage({ ...coverageFixture, rendered: [] }).issues.length);
assert.ok(inventoryCoverage({ ...coverageFixture, redirects: [] }).issues.length);
assert.ok(inventoryCoverage({ ...coverageFixture, redirects: [['/old/', '/hub/', '302']] }).issues.length);
assert.ok(inventoryCoverage({ ...coverageFixture, admitted: [] }).issues.length);
assert.ok(inventoryCoverage({ ...coverageFixture, retirements: [] }).issues.length);
const html = '<html><head></head><body><main><aside>Old preamble</aside><h1>Topic</h1><p data-definition="true">A source-backed definition.</p><section data-direct-answer="true"><p>A factual answer.</p></section><a href="/trt/states/alabama/trt-legality/">State rule</a></main></body></html>';
const meta = { route: '/trt/', date: '2026-11-02', published: '2026-06-19', description: 'Description' };
const result = shape(html, meta);
assert.equal((result.match(/<h1\b/g)||[]).length, 1);
assert.ok(result.indexOf('<h1') < result.indexOf('<aside>'));
assert.ok(result.indexOf('data-definition') < result.indexOf('<aside>'));
assert.equal(shape(result, meta), result);
assert.ok(!result.includes('href="/trt/states/alabama/trt-legality/"'));
assert.equal((result.match(/data-editorial-byline/g)||[]).length, 1);
assert.throws(() => shape('<main></main>', meta));
const withGuide = '<main><h1>Topic</h1><p data-definition="true">Definition</p><section data-direct-answer="true"><p>Evidence summary</p><p class="canonical-guide-inline" data-canonical-guide-inline="1"><a href="https://example.com/guide/">Guide</a></p></section><section class="card provider-cta">Next</section><section class="card provider-cta">Other link</section></main>';
const first = shape(withGuide, { ...meta, route: '/example/' });
const updated = shape(first, { ...meta, route: '/example/', date: '2026-11-03' });
assert.ok(updated.includes('data-canonical-guide-inline="1"'));
assert.ok(updated.includes('Evidence summary'));
assert.equal((updated.match(/data-next-step="true"/g) || []).length, 1);
assert.equal((updated.match(/data-editorial-byline="true"/g) || []).length, 1);
assert.ok(updated.includes(`Published <time datetime="${meta.published}">`));
const fs = require('fs');
const path = require('path');
const deployed = rescue.deploymentRedirects(fs.readFileSync(path.resolve(__dirname, '../../_redirects'), 'utf8'));
const parsed = deployed.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.trim().split(/\s+/));
assert.ok(parsed.length <= 2000);
assert.ok(parsed.every(([from,, status]) => !/[*:]/.test(from) && status === '301'));
// Load the actual edge module with its JSON imports supplied as data. No copy
// of the routing algorithm in the test: every retired alias exercises onRequest.
(async () => {
  const code = fs.readFileSync(path.resolve(__dirname, '../../functions/_middleware.js'), 'utf8')
    .replace("import ledger from '../data/release/route_retirements.json';", `const ledger = ${JSON.stringify(require('../../data/release/route_retirements.json'))};`)
    .replace("import policy from '../config/search_rescue.json';", `const policy = ${JSON.stringify(rescue.policy)};`);
  const { onRequest } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  for (const row of rescue.policy.retirements) {
    for (const route of new Set([row.source_path, row.source_path.replace(/\.html$/, ''), row.source_path.replace(/\/$/, '')])) {
      const response = await onRequest({ request: new Request('https://theindustryguides.com' + route + '?from=search'), next: () => { throw new Error(`Retired route reached assets: ${route}`); } });
      assert.equal(response.status, 301, route);
      assert.equal(new URL(response.headers.get('location')).pathname, row.target_path, route);
      assert.equal(new URL(response.headers.get('location')).search, '?from=search');
    }
  }
  for (const row of rescue.policy.kept) {
    const sentinel = new Response('asset');
    const response = await onRequest({ request: new Request('https://theindustryguides.com' + row.path.replace(/\.html$/, '')), next: () => sentinel });
    assert.equal(response, sentinel, `survivor must reach assets: ${row.path}`);
  }
  for (const route of ['/api/request-assistance', '/api/track-connection-click', '/assets/site.css']) {
    const sentinel = new Response('next');
    assert.equal(await onRequest({ request: new Request('https://theindustryguides.com' + route), next: () => sentinel }), sentinel);
  }
  console.log(`Search rescue behaviour: PASS (${kept.size} survivors, ${rescue.policy.retirements.length} permanent consolidations)`);
})().catch(error => { console.error(error); process.exitCode = 1; });
