'use strict';

function classifyConsoleError(message) {
  const text = String(message || '');
  const isCloudflareInsightsCspNoise =
    text.includes('https://static.cloudflareinsights.com/beacon.min.js') &&
    text.includes('violates the following Content Security Policy directive') &&
    text.includes("script-src 'self'") &&
    text.includes('The action has been blocked');

  if (isCloudflareInsightsCspNoise) {
    return {
      severity: 'WARNING',
      code: 'CLOUDFLARE_INSIGHTS_CSP_BLOCK',
      provider: 'cloudflare',
      reason: 'Provider-injected analytics beacon was correctly blocked by the site CSP; this is not a first-party application error.',
    };
  }

  return {
    severity: 'BLOCK',
    code: 'BROWSER_CONSOLE_ERROR',
    provider: null,
    reason: 'Unrecognized console error remains release-blocking.',
  };
}

module.exports = { classifyConsoleError };
