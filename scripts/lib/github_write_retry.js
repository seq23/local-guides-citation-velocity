'use strict';
/**
 * Bounded retry for GitHub API calls on a transient failure, then a NAMED error.
 *
 * 30 Oct 2026: Velocity Content Release run 41069439670 finished its release and
 * pushed it, then went red because `gh workflow run validate-repo.yml` got an HTTP
 * 500. About ten minutes later CI Health Red Recovery run 41071294097 recorded that
 * red, then went red too on a 500 from POST /issues. Neither call retried, so one
 * GitHub blip turned into two red lanes. The pushed tree was never validated, and
 * no alert was opened for it.
 *
 * Only a 5xx, a 429 or a network-level error is retried. A 4xx is a real answer
 * (bad token, wrong workflow, missing permission) and is thrown at once. After
 * `attempts` tries the caller gets GITHUB_API_TRANSIENT_EXHAUSTED, which names the
 * call and the last status. It is never a silent pass.
 *
 * Callers whose write is not idempotent must make each attempt re-read state
 * first (see ci_health_issue.js): a 500 can come back on a write that did land.
 */
const EXHAUSTED = 'GITHUB_API_TRANSIENT_EXHAUSTED';

function isTransient(err) {
  if (!err) return false;
  const s = Number(err.status);
  if (Number.isFinite(s) && s > 0) return s === 429 || (s >= 500 && s <= 599);
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET'].includes(err.code);
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withTransientRetry(label, attempt, { attempts = 4, baseDelayMs = 2000, sleep = realSleep, log = (m) => console.error(m) } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error(`withTransientRetry(${label}): attempts must be a positive integer`);
  let last;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await attempt(i);
    } catch (err) {
      if (!isTransient(err)) throw err;
      last = err;
      if (i < attempts) {
        const wait = baseDelayMs * 2 ** (i - 1);
        log(`[github-retry] ${label}: transient failure on attempt ${i}/${attempts} (${err.status || err.code}); retrying in ${wait}ms`);
        await sleep(wait);
      }
    }
  }
  const e = new Error(`${EXHAUSTED}: ${label} failed ${attempts} attempts on transient errors; last: ${last && (last.message || last.status || last.code)}`);
  e.code = EXHAUSTED;
  e.cause = last;
  throw e;
}

/** Minimal JSON transport. A non-2xx rejects with err.status set, so isTransient can classify it. */
function githubRequest(token, method, urlPath, payload) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const data = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const req = https.request({
      hostname: 'api.github.com', path: urlPath, method,
      headers: {
        'User-Agent': 'local-guides-ci',
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
    }, (res) => {
      let s = '';
      res.on('data', (d) => { s += d; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(s ? JSON.parse(s) : {});
        else {
          const err = new Error(`${method} ${urlPath} -> ${res.statusCode}: ${s.slice(0, 500)}`);
          err.status = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = { withTransientRetry, isTransient, githubRequest, EXHAUSTED };
