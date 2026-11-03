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
const coverageFixture = { admitted: ['/hub/'], rendered: ['/hub/'], retirements: [{ source_path: '/old/', target_path: '/hub/', status: 'ACTIVE_301' }], redirects: [['/old/', '/hub/', '301']], sitemap: ['https://example.com/hub/'] };
assert.deepEqual(inventoryCoverage(coverageFixture).issues, []);
assert.ok(inventoryCoverage({ ...coverageFixture, rendered: [] }).issues.length);
assert.ok(inventoryCoverage({ ...coverageFixture, redirects: [] }).issues.length);
assert.ok(inventoryCoverage({ ...coverageFixture, redirects: [['/old/', '/hub/', '302']] }).issues.length);
assert.ok(inventoryCoverage({ ...coverageFixture, admitted: [] }).issues.length);
assert.ok(inventoryCoverage({ ...coverageFixture, retirements: [] }).issues.length);
// The floor follows the sitemap: an empty sitemap, or a listed page that is not built or not admitted, fails.
assert.ok(inventoryCoverage({ ...coverageFixture, sitemap: [] }).issues.some(i => /sitemap lists no pages/.test(i)));
assert.ok(inventoryCoverage({ ...coverageFixture, sitemap: ['/hub/', '/missing/'] }).issues.some(i => /\/missing/.test(i)));
assert.ok(inventoryCoverage({ ...coverageFixture, admitted: ['/hub/', '/missing/'], sitemap: ['/hub/', '/missing/'] }).issues.some(i => /missing from indexable tree: \/missing/.test(i)));
assert.throws(() => inventoryCoverage({ ...coverageFixture, minimum: 2000 }), /fixed page minimum is retired/);
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

// Search Readiness b9, c2 and j2 on the two rescue directory hubs (/insights/,
// /atlas/), all three measured failing on 3 Nov 2026. The shape is asserted here,
// at the generator, because the hubs are rebuilt by directory() on every build and
// a page edit would be overwritten by the next one.
//
// Thin, breadcrumb-less and with no route to a lead surface is what this page WAS:
// 214 words, no BreadcrumbList, not one canonical intake link. These assertions
// fail if it goes back.
{
  const { directory, VERTICALS, HOME_LINK_SATURATED } = require('../apply_search_rescue');
  const SATURATED_HOME = 'memphisseniorcarehomes.com';
  const visibleWords = html => {
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
    assert.ok(main, 'directory() must emit a <main>');
    return main[1].replace(/<[^>]+>/g, ' ').split(/\s+/).filter(w => /[a-z0-9]/i.test(w)).length;
  };
  const frame = '<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"CollectionPage","@id":"x"},{"@type":"ItemList"}]}</script></head><body><main><h1>old</h1><p>thin</p></main></body></html>';
  const pages = [
    { path: '/insights/', page_type: 'Insight' },
    { path: '/insights/a-published-insight', page_type: 'Insight', primary_query: 'a published insight' },
    { path: '/insights/another-published-insight', page_type: 'Insight', primary_query: 'another published insight' }
  ];

  assert.ok(VERTICALS.length === 6, 'six verticals, one per canonical guide site');
  // Rule 0: a directory with nothing in it must refuse, not publish an empty hub.
  assert.throws(() => directory(frame, { path: '/insights/' }, [{ path: '/insights/', page_type: 'Insight' }]), /empty directory/);

  for (const path of ['/insights/', '/atlas/']) {
    const out = directory(frame, { path }, pages);
    const words = visibleWords(out);
    // b9: 300 words is the checklist floor for a content page. The generator clears
    // it from its own copy, not from the length of the link list, so a week with
    // few survivors cannot drop the hub back under the floor.
    assert.ok(words >= 300, `${path}: b9 wants 300+ visible words, generator produced ${words}`);
    // c2: exactly one BreadcrumbList, in the graph that already describes the page.
    assert.equal((out.match(/"BreadcrumbList"/g) || []).length, 1, `${path}: c2 wants one BreadcrumbList`);
    assert.ok(out.includes(`#breadcrumbs`), `${path}: breadcrumb node needs its @id`);

    const hrefs = [...out.matchAll(/href="([^"]+)"/g)].map(m => m[1].replaceAll('&amp;', '&'));
    for (const v of VERTICALS) {
      // j2: every field's intake is reachable from the hub. The utm attribution is
      // stamped at publish time (install_served_head_contract.js) onto exactly the
      // query-less intake URLs emitted here, so these must stay query-less.
      assert.ok(hrefs.includes(`https://${v.domain}/request-assistance/`),
        `${path}: j2 wants an untracked-at-build intake link for ${v.domain}`);
      const home = `https://${v.domain}/`;
      if (v.domain !== SATURATED_HOME) assert.ok(hrefs.includes(home), `${path}: j2 wants the canonical home for ${v.domain}`);
    }
    // The sitewide cap is a fact about the REST of the site, not a knob: pinned as
    // a literal so emptying HOME_LINK_SATURATED cannot make this assertion agree
    // with itself. https://memphisseniorcarehomes.com/ is contract-required on ten
    // pages (homepage card, senior hub, eight senior guides) and
    // velocity-canonical-anchor-links caps any one of its URLs at ten sitewide, so
    // an eleventh link from either hub turns the merge gate red.
    assert.ok(!hrefs.includes(`https://${SATURATED_HOME}/`),
      `${path}: ${SATURATED_HOME} home is at its sitewide cap of 10; linking it here turns velocity-canonical-anchor-links red`);
    assert.ok(HOME_LINK_SATURATED.has(SATURATED_HOME),
      `${SATURATED_HOME} must stay in HOME_LINK_SATURATED or the generator will link its home again`);
    // j2 still needs a canonical home on the page: the other five carry it.
    assert.ok(hrefs.some(h => VERTICALS.some(v => v.domain !== SATURATED_HOME && h === `https://${v.domain}/`)),
      `${path}: j2 wants at least one canonical home link`);
    // g3: no single portfolio domain over a quarter of the hub's outbound links.
    const out_hosts = hrefs.filter(h => h.startsWith('http') && new URL(h).hostname !== 'theindustryguides.com')
      .map(h => new URL(h).hostname);
    assert.ok(out_hosts.length > 0, `${path}: expected outbound portfolio links`);
    const worst = Math.max(...Object.values(out_hosts.reduce((a, h) => (a[h] = (a[h] || 0) + 1, a), {})));
    assert.ok(worst / out_hosts.length <= 0.25,
      `${path}: g3 caps one domain at a quarter of ${out_hosts.length} outbound links, worst is ${worst}`);
  }
  console.log('Search rescue directory shape: PASS (b9 words, c2 breadcrumb, j2 intake + canonical home, g3 share)');
}
