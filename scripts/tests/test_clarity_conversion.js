'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { resolveCards } = require('../lib/umbrella_homepage');
const { installProviderStart } = require('../lib/provider_start');

const ROOT = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'dist/index.html'), 'utf8');
const loader = fs.readFileSync(path.join(ROOT, 'dist/assets/clarity-loader.js'), 'utf8');
const cards = resolveCards(ROOT);

test('provider template is idempotent and refuses a missing insertion point', () => {
  assert.equal(installProviderStart(html, ROOT), html);
  assert.throws(() => installProviderStart('<html><head></head></html>', ROOT), /refusing to write/);
});

test('served homepage: no analytics before consent; host id, withdrawal and six real destinations', async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage();
    const errors = [];
    const clarityRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname.endsWith('clarity.ms')) {
        clarityRequests.push(url.href);
        // Do not send synthetic sessions to the actual analytics project.
        return route.fulfill({ contentType: 'application/javascript', body: 'window.consentCalls = Array.from(window.clarity.q || [], x => Array.from(x)); window.clarity = (...args) => window.consentCalls.push(args);' });
      }
      if (url.hostname === 'theindustryguides.com' || url.hostname === 'preview.invalid') {
        if (url.pathname === '/assets/clarity-loader.js') return route.fulfill({ contentType: 'application/javascript', body: loader });
        if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        const asset = path.join(ROOT, 'dist', url.pathname);
        if (fs.existsSync(asset) && fs.statSync(asset).isFile()) {
          const types = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png' };
          return route.fulfill({ contentType: types[path.extname(asset)] || 'application/octet-stream', body: fs.readFileSync(asset) });
        }
      }
      if (route.request().resourceType() === 'script') return route.fulfill({ contentType: 'application/javascript', body: '' });
      if (route.request().resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
      return route.fulfill({ contentType: 'text/html', body: '<h1>Provider request form</h1>' });
    });

    await page.goto('https://theindustryguides.com/');
    await page.locator('[data-provider-start]').waitFor({ state: 'visible' });
    await page.locator('[data-provider-start-section]').screenshot({ path: '/tmp/sr-industryguides-provider-start.png' });
    assert.equal(clarityRequests.length, 0, 'loading the form must not request Clarity');
    await page.locator('[data-analytics-allow]').click();
    await page.waitForFunction(() => Array.isArray(window.consentCalls));
    assert.deepEqual(clarityRequests, ['https://www.clarity.ms/tag/y7ktdoryc2']);
    assert.deepEqual(await page.evaluate(() => window.consentCalls), [['consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' }]]);
    await page.locator('[data-analytics-stop]').click();
    assert.deepEqual(await page.evaluate(() => window.consentCalls.slice(-2)), [['consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' }], ['stop']]);

    for (const card of cards) {
      await page.goto('https://theindustryguides.com/');
      await page.locator('[data-provider-start]').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => typeof window.clarity), 'undefined', 'consent is not inherited on a later visit');
      await page.locator('#provider-guide').selectOption(card.provider);
      await page.locator('[data-provider-start] button[type="submit"]').click();
      await page.waitForURL(card.provider);
      assert.equal(page.url(), card.provider, `route ${card.vertical} without analytics consent`);
    }
    assert.equal(clarityRequests.length, 1, 'routing must work with analytics off');

    await page.goto('https://preview.invalid/');
    await page.locator('[data-provider-start]').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-analytics-choice]').isVisible(), false, 'unknown hosts cannot send sessions to the production project');
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
