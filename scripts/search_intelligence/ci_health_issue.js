'use strict';
/**
 * Open, update or close the governed CI-health alert, with bounded retry.
 *
 * Every attempt re-reads the open alerts BEFORE it writes. A 500 from
 * POST /issues does not prove the issue was not created, so a retry that just
 * re-POSTed could open a duplicate. A retry that re-reads finds the issue the
 * phantom-failed POST created and PATCHes it instead.
 */
const { withTransientRetry } = require('../lib/github_write_retry.js');

// Follow pages. A single unpaginated page of 50 meant that past 50 open
// labelled issues the standing alert became invisible and a duplicate was
// opened on every red run.
async function findAlert(request, owner, name, title) {
  for (let page = 1; page <= 20; page += 1) {
    const issues = await request('GET', `/repos/${owner}/${name}/issues?state=open&labels=automation-health&per_page=100&page=${page}`);
    if (!Array.isArray(issues) || issues.length === 0) return null;
    const hit = issues.find((x) => x.title === title);
    if (hit) return hit;
    if (issues.length < 100) return null;
  }
  return null;
}

/** Returns { action: 'closed'|'none'|'updated'|'opened', number? }. */
async function syncAlert(request, { owner, name, title, body, recovered, closeBody }, retryOpts = {}) {
  return withTransientRetry(`ci-health alert "${title}"`, async () => {
    const issue = await findAlert(request, owner, name, title);
    if (recovered) {
      if (!issue) return { action: 'none' };
      await request('PATCH', `/repos/${owner}/${name}/issues/${issue.number}`, { state: 'closed', body: closeBody });
      return { action: 'closed', number: issue.number };
    }
    if (issue) {
      await request('PATCH', `/repos/${owner}/${name}/issues/${issue.number}`, { body });
      return { action: 'updated', number: issue.number };
    }
    const made = await request('POST', `/repos/${owner}/${name}/issues`, { title, body, labels: ['automation-health'] });
    return { action: 'opened', number: made && made.number };
  }, retryOpts);
}

module.exports = { syncAlert, findAlert };
