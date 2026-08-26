#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { classifyConsoleError } = require('./console_error_policy');

const ROOT = path.resolve(__dirname, '../..');
const SUMMARY_DIR = path.join(ROOT, 'artifacts/diagnostics/click-audit');
const SUMMARY_PATH = path.join(SUMMARY_DIR, 'summary.json');
const base =
  process.env.PLAYWRIGHT_BASE_URL ||
  process.env.POSTDEPLOY_BASE_URL ||
  process.env.PUBLIC_BASE_URL;

if (!base) {
  console.error('BROWSER_BASE_URL_MISSING');
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('BROWSER_RUNTIME_MISSING: install playwright and Chromium');
  process.exit(2);
}

const contract = JSON.parse(
  fs.readFileSync(path.join(ROOT, '_browser_suite_contract.json'), 'utf8')
);

const IMPLEMENTED_ASSERTIONS = new Set([
  'route_loads',
  'h1_present',
  'required_artifact_visible_if_governed',
  'navigation_works',
  'disclosure_visible',
  'no_horizontal_overflow',
  'no_broken_images',
  'no_console_errors',
  'no_failed_local_assets',
  'canonical_correct',
  'table_responsive',
  'cta_ad_separation',
]);

const RETRIES = Number(process.env.PUBLIC_CLICK_AUDIT_RETRIES || 2);
const RETRY_DELAY_MS = Number(process.env.PUBLIC_CLICK_AUDIT_RETRY_DELAY_MS || 2500);
const NAVIGATION_TIMEOUT_MS = Number(process.env.PUBLIC_CLICK_AUDIT_TIMEOUT_MS || 45000);
// `networkidle` was the single largest cost in this audit. The deployed site
// carries provider analytics (Cloudflare Insights, Clarity/Bing sync) that keep
// issuing requests indefinitely, so the 500ms-quiet condition never arrived and
// every navigation burned the full 45s timeout, three times per case. Waiting
// for `load` proves exactly the same thing for all twelve assertions - `load`
// means the document and every subresource, images included, have finished -
// and a bounded settle window afterwards still catches the late provider
// console errors, which measurably all arrive within ~1s of `load`.
const LOAD_STATE_TIMEOUT_MS = Number(process.env.PUBLIC_CLICK_AUDIT_LOAD_TIMEOUT_MS || 20000);
const SETTLE_MS = Number(process.env.PUBLIC_CLICK_AUDIT_SETTLE_MS || 2500);
// Cases are independent - each already gets its own browser context - so they
// run through a bounded worker pool instead of one at a time. Results are
// written back by index, so the report stays byte-identical in ordering.
const CONCURRENCY = Math.max(1, Number(process.env.PUBLIC_CLICK_AUDIT_CONCURRENCY || 6));
// A retry only ever rescues a flaky case. When the same failure signature keeps
// repeating it is systemic, and retrying it just multiplies the runtime by the
// retry count without changing a single verdict. Once a signature has failed
// this many distinct cases, later cases carrying it are not retried.
const SYSTEMIC_THRESHOLD = Math.max(2, Number(process.env.PUBLIC_CLICK_AUDIT_SYSTEMIC_THRESHOLD || 3));

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Signature = the set of failing assertion codes, ignoring the variable detail
// after the colon (status codes, cache-busting query strings, request ids).
function failureSignature(result) {
  return [...new Set((result.failures || []).map(entry => String(entry).split(':')[0].trim()))]
    .sort()
    .join('+') || 'unknown';
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}

function writeSummary(report) {
  fs.mkdirSync(SUMMARY_DIR, { recursive: true });
  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(report, null, 2) + '\n');
}

function targetUrl(route) {
  return new URL(route, base).toString();
}

function failureLine(result) {
  return `${result.device} ${result.route} :: ${result.failures.join('; ')}`;
}

async function navigationWorks(page) {
  const link = page
    .locator('nav a[href], header a[href]')
    .filter({ hasNot: page.locator('[aria-disabled="true"]') })
    .first();

  if ((await link.count()) === 0) return false;

  const href = await link.getAttribute('href');
  if (!href || href === '#' || /^javascript:/i.test(href)) return false;

  const baseOrigin = new URL(base).origin;
  const target = new URL(href, base);
  if (target.origin !== baseOrigin) return true;

  const probe = await page.context().newPage();
  try {
    const response = await probe.goto(target.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    return Boolean(response && response.ok() && (await probe.locator('body').count()));
  } finally {
    await probe.close();
  }
}

async function assertPage(page, check, response, consoleErrors, failedRequests) {
  const failures = [];
  const expected = targetUrl(check.route);

  if (!response || !response.ok()) {
    failures.push(`route_loads:${response ? response.status() : 'no-response'}`);
  }

  if ((await page.locator('h1').count()) !== 1) {
    failures.push('h1_present');
  }

  const governed = await page
    .locator('[data-content-atom], [data-citation-artifact], [data-state-authority="true"], table, ol')
    .count();
  if (check.route !== '/' && governed < 1) {
    failures.push('required_artifact_visible_if_governed');
  }

  if (!(await navigationWorks(page))) {
    failures.push('navigation_works');
  }

  const disclosure = await page
    .locator('footer, .disclaimer, [data-disclosure], a[href*="disclaimer"]')
    .count();
  if (disclosure < 1) {
    failures.push('disclosure_visible');
  }

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  if (hasHorizontalOverflow) {
    failures.push('no_horizontal_overflow');
  }

  const brokenImages = await page.locator('img').evaluateAll(imgs =>
    imgs
      .filter(img => !img.complete || img.naturalWidth === 0)
      .map(img => img.src)
  );
  if (brokenImages.length) {
    failures.push(`no_broken_images:${brokenImages.length}`);
  }

  if (consoleErrors.length) {
    failures.push(`no_console_errors:${consoleErrors.join('|')}`);
  }

  if (failedRequests.length) {
    failures.push(`no_failed_local_assets:${failedRequests.join('|')}`);
  }

  const canonical = await page
    .locator('link[rel="canonical"]')
    .getAttribute('href')
    .catch(() => null);
  // Cloudflare Pages serves `foo.html` at `/foo` and 308-redirects the `.html`
  // form, so the canonical names the extensionless URL - the one that returns
  // 200. Comparing against the `.html` route would require the canonical to
  // point at a redirect. Normalise both sides the way the host does.
  const stripHtml = (p) => (p.endsWith('.html') ? p.slice(0, -5) : p);
  const expectedPath = stripHtml(new URL(expected).pathname);
  if (!canonical || stripHtml(new URL(canonical, base).pathname) !== expectedPath) {
    failures.push(`canonical_correct:${canonical || 'missing'}`);
  }

  const badTables = await page.locator('table').evaluateAll(ts =>
    ts.filter(t => {
      const parent = t.parentElement;
      return (
        t.scrollWidth > document.documentElement.clientWidth + 2 &&
        (!parent || getComputedStyle(parent).overflowX === 'visible')
      );
    }).length
  );
  if (badTables) {
    failures.push(`table_responsive:${badTables}`);
  }

  const ctaOverlap = await page
    .locator('[data-provider-cta], .provider-cta, .cta')
    .evaluateAll(nodes => {
      const ads = [...document.querySelectorAll('[data-ad], .ad, .advertisement')];
      return nodes.some(node => {
        const a = node.getBoundingClientRect();
        return ads.some(ad => {
          const b = ad.getBoundingClientRect();
          return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
        });
      });
    });
  if (ctaOverlap) {
    failures.push('cta_ad_separation');
  }

  return failures;
}

async function runCheck(browser, check, attempt) {
  const viewport = check.device === 'mobile'
    ? { width: 390, height: 844 }
    : { width: 1440, height: 1000 };
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  const providerConsoleWarnings = [];
  const failedRequests = [];
  const baseOrigin = new URL(base).origin;

  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    const classification = classifyConsoleError(text);
    if (classification.severity === 'WARNING') providerConsoleWarnings.push({ ...classification, message: text });
    else consoleErrors.push(text);
  });
  page.on('requestfailed', request => {
    try {
      const url = new URL(request.url());
      if (url.origin === baseOrigin) {
        failedRequests.push(`${url.pathname}:${request.failure()?.errorText || 'failed'}`);
      }
    } catch {
      // Ignore unparsable browser-internal request URLs.
    }
  });

  try {
    const response = await page.goto(targetUrl(check.route), {
      waitUntil: 'domcontentloaded',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    let loadStateTimedOut = false;
    try {
      await page.waitForLoadState('load', { timeout: LOAD_STATE_TIMEOUT_MS });
    } catch {
      loadStateTimedOut = true;
    }
    await sleep(SETTLE_MS);
    const failures = await assertPage(page, check, response, consoleErrors, failedRequests);
    // Under the old `networkidle` wait a page that never reached `load` threw and
    // failed the case. Keep that verdict rather than silently asserting against a
    // half-loaded document.
    if (loadStateTimedOut) failures.unshift('route_loads:load_state_timeout');
    return {
      ...check,
      status: failures.length ? 'FAIL' : 'PASS',
      failures,
      provider_console_warnings: providerConsoleWarnings,
      attempt,
    };
  } catch (error) {
    return {
      ...check,
      status: 'FAIL',
      failures: [error && error.message ? error.message : String(error)],
      attempt,
    };
  } finally {
    await context.close();
  }
}

async function runCheckWithRetry(browser, check, systemic) {
  const attempts = [];
  let suppressed = null;
  for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
    const result = await runCheck(browser, check, attempt);
    attempts.push(result);
    if (result.status === 'PASS') {
      return attempts.length === 1
        ? result
        : { ...result, recovered_after_attempts: attempts.length, previous_failures: attempts.slice(0, -1) };
    }

    const signature = failureSignature(result);
    if (!systemic.has(signature)) systemic.set(signature, new Set());
    systemic.get(signature).add(check.id || `${check.device}:${check.route}`);

    if (attempt > RETRIES) break;

    // Same signature twice in a row is a deterministic failure, not a flake. A
    // third identical attempt cannot change the verdict, only the clock.
    if (attempts.length > 1 && failureSignature(attempts[attempts.length - 2]) === signature) {
      suppressed = 'deterministic';
      break;
    }
    // The signature is already failing across the suite. Retrying it on every
    // remaining case is what turned a one-pass audit into a timeout.
    if (systemic.get(signature).size >= SYSTEMIC_THRESHOLD) {
      suppressed = 'systemic';
      break;
    }

    console.error(`PUBLIC CLICK AUDIT RETRY ${attempt}/${RETRIES}: ${failureLine(result)}`);
    await sleep(RETRY_DELAY_MS);
  }
  const last = attempts[attempts.length - 1];
  if (suppressed) {
    console.error(`PUBLIC CLICK AUDIT RETRY SUPPRESSED (${suppressed}): ${failureLine(last)}`);
  }
  return {
    ...last,
    attempts,
    failure_signature: failureSignature(last),
    ...(suppressed ? { retry_suppressed: suppressed } : {}),
  };
}

(async () => {
  const max = Number(contract.count_policy?.maximum_test_cases || 99);
  const min = Number(contract.count_policy?.minimum_test_cases || 1);

  if (contract.checks.length < min || contract.checks.length > max || contract.checks.length >= 100) {
    throw new Error(`BROWSER_SUITE_COUNT_POLICY:${contract.checks.length}`);
  }

  const declared = new Set(contract.checks.flatMap(check => check.assertions || []));
  for (const assertion of declared) {
    if (!IMPLEMENTED_ASSERTIONS.has(assertion)) {
      throw new Error(`UNIMPLEMENTED_BROWSER_ASSERTION:${assertion}`);
    }
  }

  const browser = await chromium.launch({ headless: true });
  const systemic = new Map();
  const startedAt = Date.now();
  let results = [];

  try {
    // Every case in the contract runs on every run. This audit is bounded at 36
    // cases by the contract's count policy, so it is exhaustive, not sampled -
    // no route rotation, no long-tail slice, nothing skipped.
    results = await runPool(contract.checks, CONCURRENCY, check =>
      runCheckWithRetry(browser, check, systemic)
    );
  } finally {
    await browser.close();
  }

  const wallMs = Date.now() - startedAt;

  const failed = results.filter(result => result.status === 'FAIL');
  const recovered = results.filter(result => result.recovered_after_attempts);
  const providerWarnings = results.flatMap(result => (result.provider_console_warnings || []).map(warning => ({ device: result.device, route: result.route, ...warning })));
  const report = {
    status: failed.length ? 'FAIL' : 'PASS',
    test_cases: results.length,
    assertions_per_case: contract.assertions_per_case,
    total_assertions: results.length * contract.assertions_per_case,
    failed_count: failed.length,
    recovered_count: recovered.length,
    provider_console_warning_count: providerWarnings.length,
    provider_console_warnings: providerWarnings,
    coverage_mode: 'exhaustive',
    sampled: false,
    wall_ms: wallMs,
    concurrency: CONCURRENCY,
    retry_policy: {
      retries: RETRIES,
      retry_delay_ms: RETRY_DELAY_MS,
      navigation_timeout_ms: NAVIGATION_TIMEOUT_MS,
      load_state_timeout_ms: LOAD_STATE_TIMEOUT_MS,
      settle_ms: SETTLE_MS,
      systemic_threshold: SYSTEMIC_THRESHOLD,
    },
    attempt_count: results.reduce((total, result) => total + (result.attempts ? result.attempts.length : (result.previous_failures || []).length + 1), 0),
    systemic_signatures: [...systemic.entries()]
      .filter(([, cases]) => cases.size >= SYSTEMIC_THRESHOLD)
      .map(([signature, cases]) => ({ signature, case_count: cases.size })),
    skipped_count: 0,
    base_url: base,
    failed_routes: failed.map(failureLine),
    recovered_routes: recovered.map(result => `${result.device} ${result.route}`),
    results,
  };

  writeSummary(report);

  if (failed.length) {
    console.error(`PUBLIC CLICK AUDIT FAIL: ${failed.length}/${results.length} in ${Math.round(wallMs / 1000)}s at concurrency ${CONCURRENCY}`);
    for (const result of failed) {
      console.error(`PUBLIC CLICK AUDIT FAILURE: ${failureLine(result)}`);
    }
    console.error(`PUBLIC CLICK AUDIT SUMMARY: ${path.relative(ROOT, SUMMARY_PATH)}`);
    process.exit(1);
  }

  if (recovered.length) {
    console.log(`PUBLIC CLICK AUDIT RECOVERED: ${recovered.length}/${results.length} cases passed after retry`);
  }
  console.log(`PUBLIC CLICK AUDIT PASS: ${results.length} cases, ${results.length * contract.assertions_per_case} assertions in ${Math.round(wallMs / 1000)}s at concurrency ${CONCURRENCY}`);
})().catch(error => {
  const report = {
    status: 'ERROR',
    base_url: base,
    error: error && error.stack ? error.stack : String(error),
    results: [],
  };
  writeSummary(report);
  console.error(error);
  console.error(`PUBLIC CLICK AUDIT SUMMARY: ${path.relative(ROOT, SUMMARY_PATH)}`);
  process.exit(1);
});
