'use strict';
// Behaviour pins for scripts/lib/github_write_retry.js and the CI-health alert
// sync (30 Oct 2026: a GitHub 500 turned two lanes red). Stubbed transport, no network.
const assert = require('assert');
const { withTransientRetry, isTransient, EXHAUSTED } = require('../lib/github_write_retry.js');
const { syncAlert } = require('../search_intelligence/ci_health_issue.js');

const http = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
const fast = { sleep: async () => {}, log: () => {}, baseDelayMs: 1 };
const pins = [];
const pin = (name, fn) => pins.push([name, fn]);

pin('500 then 200 succeeds on the second attempt', async () => {
  let n = 0;
  const r = await withTransientRetry('t', async () => { n += 1; if (n === 1) throw http(500); return 'ok'; }, fast);
  assert.strictEqual(r, 'ok'); assert.strictEqual(n, 2);
});
pin('429 and a network reset are transient', async () => {
  assert.ok(isTransient(http(429))); assert.ok(isTransient(http(503)));
  assert.ok(isTransient(Object.assign(new Error('x'), { code: 'ECONNRESET' })));
});
pin('a 4xx is a real answer: thrown at once, no retry', async () => {
  let n = 0;
  await assert.rejects(withTransientRetry('t', async () => { n += 1; throw http(404); }, fast), (e) => e.status === 404);
  assert.strictEqual(n, 1);
  assert.ok(!isTransient(http(401)) && !isTransient(http(422)));
});
pin('persistent 5xx is bounded and ends in the named error', async () => {
  let n = 0;
  await assert.rejects(withTransientRetry('dispatch x', async () => { n += 1; throw http(500); }, { ...fast, attempts: 4 }),
    (e) => e.code === EXHAUSTED && e.message.startsWith(`${EXHAUSTED}: dispatch x failed 4 attempts`));
  assert.strictEqual(n, 4);
});
pin('backoff doubles between attempts', async () => {
  const waits = [];
  await assert.rejects(withTransientRetry('t', async () => { throw http(502); }, { attempts: 3, baseDelayMs: 100, log: () => {}, sleep: async (ms) => { waits.push(ms); } }));
  assert.deepStrictEqual(waits, [100, 200]);
});

function fakeGithub({ failFirstPost = false, landOnFailure = false, open = [] } = {}) {
  const issues = open.slice(); const calls = []; let posts = 0;
  const request = async (method, url, payload) => {
    calls.push(`${method} ${url.split('?')[0]}`);
    if (method === 'GET') return issues.filter((i) => i.state === 'open');
    if (method === 'POST') {
      posts += 1;
      const made = { number: 100 + posts, title: payload.title, state: 'open' };
      if (posts === 1 && failFirstPost) { if (landOnFailure) issues.push(made); throw http(500); }
      issues.push(made); return made;
    }
    if (method === 'PATCH') { const n = Number(url.split('/').pop()); const i = issues.find((x) => x.number === n); if (payload.state) i.state = payload.state; return i; }
    throw new Error(method);
  };
  return { request, issues, calls, posts: () => posts };
}
const args = { owner: 'o', name: 'n', title: '[Automation Health] X CI RED', body: 'b', recovered: false, closeBody: 'c' };

pin('a 500 on POST /issues that DID land is not duplicated on retry', async () => {
  const g = fakeGithub({ failFirstPost: true, landOnFailure: true });
  const r = await syncAlert(g.request, args, fast);
  assert.strictEqual(r.action, 'updated'); assert.strictEqual(g.posts(), 1);
  assert.strictEqual(g.issues.filter((i) => i.state === 'open').length, 1);
});
pin('a 500 on POST /issues that did NOT land is retried and opens one alert', async () => {
  const g = fakeGithub({ failFirstPost: true, landOnFailure: false });
  const r = await syncAlert(g.request, args, fast);
  assert.strictEqual(r.action, 'opened'); assert.strictEqual(g.issues.length, 1);
});
pin('a standing alert is updated, never re-opened', async () => {
  const g = fakeGithub({ open: [{ number: 7, title: args.title, state: 'open' }] });
  const r = await syncAlert(g.request, args, fast);
  assert.deepStrictEqual(r, { action: 'updated', number: 7 }); assert.strictEqual(g.posts(), 0);
});
pin('recovery closes the standing alert, and is a no-op with none', async () => {
  const g = fakeGithub({ open: [{ number: 7, title: args.title, state: 'open' }] });
  assert.deepStrictEqual(await syncAlert(g.request, { ...args, recovered: true }, fast), { action: 'closed', number: 7 });
  const h = fakeGithub();
  assert.deepStrictEqual(await syncAlert(h.request, { ...args, recovered: true }, fast), { action: 'none' });
});

(async () => {
  let pass = 0;
  for (const [name, fn] of pins) {
    try { await fn(); pass += 1; } catch (e) { console.error(`FAIL: ${name}: ${e.message}`); }
  }
  if (!pins.length || pass !== pins.length) { console.error(`github_write_retry: ${pass}/${pins.length} behaviour pins pass`); process.exit(1); }
  console.log(`github_write_retry: ${pass} behaviour pins pass`);
})();
