#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
  const expectedPath = new URL(expected).pathname;
  if (!canonical || new URL(canonical, base).pathname !== expectedPath) {
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
  const failedRequests = [];
  const baseOrigin = new URL(base).origin;

  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
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
      waitUntil: 'networkidle',
      timeout: NAVIGATION_TIMEOUT_MS,
    });
    const failures = await assertPage(page, check, response, consoleErrors, failedRequests);
    return {
      ...check,
      status: failures.length ? 'FAIL' : 'PASS',
      failures,
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

async function runCheckWithRetry(browser, check) {
  const attempts = [];
  for (let attempt = 1; attempt <= RETRIES + 1; attempt += 1) {
    const result = await runCheck(browser, check, attempt);
    attempts.push(result);
    if (result.status === 'PASS') {
      return attempts.length === 1
        ? result
        : { ...result, recovered_after_attempts: attempts.length, previous_failures: attempts.slice(0, -1) };
    }
    if (attempt <= RETRIES) {
      console.error(`PUBLIC CLICK AUDIT RETRY ${attempt}/${RETRIES}: ${failureLine(result)}`);
      await sleep(RETRY_DELAY_MS);
    }
  }
  const last = attempts[attempts.length - 1];
  return { ...last, attempts };
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
  const results = [];

  try {
    for (const check of contract.checks) {
      results.push(await runCheckWithRetry(browser, check));
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter(result => result.status === 'FAIL');
  const recovered = results.filter(result => result.recovered_after_attempts);
  const report = {
    status: failed.length ? 'FAIL' : 'PASS',
    test_cases: results.length,
    assertions_per_case: contract.assertions_per_case,
    total_assertions: results.length * contract.assertions_per_case,
    failed_count: failed.length,
    recovered_count: recovered.length,
    retry_policy: {
      retries: RETRIES,
      retry_delay_ms: RETRY_DELAY_MS,
      navigation_timeout_ms: NAVIGATION_TIMEOUT_MS,
    },
    skipped_count: 0,
    base_url: base,
    failed_routes: failed.map(failureLine),
    recovered_routes: recovered.map(result => `${result.device} ${result.route}`),
    results,
  };

  writeSummary(report);

  if (failed.length) {
    console.error(`PUBLIC CLICK AUDIT FAIL: ${failed.length}/${results.length}`);
    for (const result of failed) {
      console.error(`PUBLIC CLICK AUDIT FAILURE: ${failureLine(result)}`);
    }
    console.error(`PUBLIC CLICK AUDIT SUMMARY: ${path.relative(ROOT, SUMMARY_PATH)}`);
    process.exit(1);
  }

  if (recovered.length) {
    console.log(`PUBLIC CLICK AUDIT RECOVERED: ${recovered.length}/${results.length} cases passed after retry`);
  }
  console.log(`PUBLIC CLICK AUDIT PASS: ${results.length} cases, ${results.length * contract.assertions_per_case} assertions`);
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
