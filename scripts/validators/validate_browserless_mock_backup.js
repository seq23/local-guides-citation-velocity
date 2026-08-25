#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const contractPath = path.join(ROOT, '_browser_suite_contract.json');
const manifestPath = path.join(ROOT, '_public_route_manifest.json');
const fixturePath = path.join(ROOT, 'data/mocks/browserless-route-audit-fixtures.json');
const outPath = path.join(ROOT, 'artifacts/validation/browserless-mock-audit.json');
const backupPath = path.join(ROOT, 'artifacts/validation/mock-browser-backup.json');
const reportPath = path.join(ROOT, 'reports/browserless-mock-audit.md');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function ensureDir(p) { fs.mkdirSync(path.dirname(p), {recursive: true}); }
function routeToFile(route) {
  const clean = String(route || '/').split('?')[0].split('#')[0];
  if (clean === '/' || clean === '') return 'index.html';
  const rel = clean.replace(/^\//, '').replace(/\/$/, '');
  if (/\.[a-z0-9]{2,8}$/i.test(rel)) return rel;
  return rel + '/index.html';
}
function stripTags(html) { return html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' '); }
function getAttrValues(html, attr) {
  const values = [];
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'gi');
  let m;
  while ((m = re.exec(html))) values.push(m[1]);
  return values;
}
function localAssetExists(src, route) {
  if (!src || /^(https?:|mailto:|tel:|data:|#|javascript:)/i.test(src)) return true;
  if (src.startsWith('/')) return fs.existsSync(path.join(ROOT, src.replace(/^\//, '')));
  const base = path.dirname(path.join(ROOT, routeToFile(route)));
  return fs.existsSync(path.resolve(base, src));
}
function localHrefExists(href) {
  if (!href || /^(https?:|mailto:|tel:|data:|#|javascript:)/i.test(href)) return true;
  const clean = href.split('?')[0].split('#')[0];
  if (clean.startsWith('/')) {
    const direct = path.join(ROOT, clean.replace(/^\//, ''));
    if (fs.existsSync(direct)) return true;
    if (/\.[a-z0-9]{2,8}$/i.test(clean)) return false;
    // Public URLs are extensionless: Cloudflare Pages serves `foo.html` at
    // `/foo` and 308-redirects the `.html` form, so internal links now use the
    // form that returns 200 while the rendered file keeps its extension.
    // Resolve `/insights/foo` to insights/foo.html before falling back to a
    // directory index, or every such link reads as broken.
    if (fs.existsSync(`${direct}.html`)) return true;
    return fs.existsSync(path.join(ROOT, routeToFile(clean)));
  }
  return true;
}
function canonicalPath(html) {
  const m = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i) || html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["'][^>]*>/i);
  if (!m) return null;
  try { return new URL(m[1], 'https://example.test').pathname.replace(/\/$/, '/') || '/'; }
  catch { return null; }
}
function routePath(route) {
  const p = new URL(route, 'https://example.test').pathname;
  // Expect the public URL, which is what the canonical now declares. Pages
  // serves `foo.html` at `/foo` and 308-redirects the `.html` form, so a
  // canonical naming the `.html` route would point at a redirect.
  if (/\.html$/i.test(p)) return p.slice(0, -5);
  if (/\.[a-z0-9]{2,8}$/i.test(p)) return p;
  return p.endsWith('/') ? p : p + '/';
}
function checkRoute(check, html) {
  const failures = [];
  const warnings = [];
  const plain = stripTags(html);
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count !== 1) failures.push(`h1_present:${h1Count}`);
  if (check.route !== '/') {
    const governed = /data-content-atom|data-citation-artifact|data-state-authority|<table\b|<ol\b|<section\b/i.test(html);
    if (!governed) failures.push('required_artifact_visible_if_governed');
  }
  const navLinks = [...html.matchAll(/<(?:nav|header)[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
  const allLinks = getAttrValues(html, 'href');
  if (!navLinks.length && !allLinks.some(h => !/^#/.test(h))) failures.push('navigation_works:no_navigation_anchor');
  const brokenHref = allLinks.filter(h => !localHrefExists(h)).slice(0, 10);
  if (brokenHref.length) failures.push(`navigation_works:missing_local_hrefs:${brokenHref.join('|')}`);
  if (!/(<footer\b|disclaimer|educational|not legal advice|not medical advice|no endorsement|privacy|methodology)/i.test(html)) failures.push('disclosure_visible');
  const srcs = [...getAttrValues(html, 'src'), ...getAttrValues(html, 'srcset').flatMap(v => v.split(',').map(s => s.trim().split(/\s+/)[0]))];
  const brokenAssets = srcs.filter(src => !localAssetExists(src, check.route)).slice(0, 10);
  if (brokenAssets.length) failures.push(`no_broken_images_or_assets:${brokenAssets.join('|')}`);
  const localAssetHrefs = allLinks.filter(h => /\.(css|js|png|jpg|jpeg|gif|svg|webp|ico|json|xml|txt)$/i.test(h));
  const missingLocalAssets = localAssetHrefs.filter(h => !localAssetExists(h, check.route)).slice(0, 10);
  if (missingLocalAssets.length) failures.push(`no_failed_local_assets:${missingLocalAssets.join('|')}`);
  const canon = canonicalPath(html);
  if (!canon || canon !== routePath(check.route)) failures.push(`canonical_correct:${canon || 'missing'}!=${routePath(check.route)}`);
  if (/<table\b/i.test(html) && !/(table-responsive|table-wrap|table-container|overflow-x\s*:\s*auto|overflow-x-auto)/i.test(html)) warnings.push('table_responsive:browserless_source_guard_only');
  const longTokens = plain.split(/\s+/).filter(t => t.length > 160 && !/^https?:/.test(t)).slice(0, 5);
  if (longTokens.length) failures.push(`no_horizontal_overflow:long_unbroken_tokens:${longTokens.map(t => t.slice(0, 40)).join('|')}`);
  if (/(console\.error\(|throw new Error\(|debugger;)/i.test(html)) warnings.push('no_console_errors:browserless_static_warning');
  if (/data-provider-cta|provider-cta|class=["'][^"']*cta/i.test(html) && /data-ad|class=["'][^"']*(ad|advertisement)/i.test(html)) warnings.push('cta_ad_separation:geometry_requires_real_browser');
  return {failures, warnings};
}

const contract = readJson(contractPath);
const manifest = readJson(manifestPath);
const fixture = readJson(fixturePath);
const errors = [];
const warnings = [];
if (fixture.schema_version !== '1.0') errors.push('fixture_schema_version');
if (fixture.browserless_only !== true) errors.push('fixture_browserless_only_flag');
if (fixture.contract_sha256 !== sha256(fs.readFileSync(contractPath))) errors.push('fixture_contract_sha256_drift');
if (fixture.route_manifest_sha256 !== sha256(fs.readFileSync(manifestPath))) errors.push('fixture_route_manifest_sha256_drift');
const routeSet = new Set((manifest.routes || []).map(r => r.path));
const expectedCaseIds = new Set((contract.checks || []).map(c => c.id));
const fixtureCaseIds = new Set((fixture.cases || []).map(c => c.id));
for (const id of expectedCaseIds) if (!fixtureCaseIds.has(id)) errors.push(`fixture_missing_case:${id}`);
for (const id of fixtureCaseIds) if (!expectedCaseIds.has(id)) errors.push(`fixture_extra_case:${id}`);
const results = [];
for (const check of contract.checks || []) {
  if (!routeSet.has(check.route)) errors.push(`contract_route_missing_manifest:${check.id}`);
  const rel = routeToFile(check.route);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    results.push({...check, file: rel, status: 'FAIL', failures: ['route_loads:file_missing'], warnings: []});
    continue;
  }
  const html = fs.readFileSync(abs, 'utf8');
  const {failures, warnings: routeWarnings} = checkRoute(check, html);
  results.push({
    ...check,
    file: rel,
    html_sha256: sha256(html),
    status: failures.length ? 'FAIL' : 'PASS',
    failures,
    warnings: routeWarnings
  });
  warnings.push(...routeWarnings.map(w => `${check.id}:${w}`));
}
const failed = results.filter(r => r.status === 'FAIL');
const assertionLimitOk = Number(contract.count_policy?.maximum_test_cases || 99) >= results.length && results.length >= Number(contract.count_policy?.minimum_test_cases || 1) && results.length < 100;
if (!assertionLimitOk) errors.push(`count_policy:${results.length}`);
const report = {
  schema_version: '1.0',
  generated_at: new Date().toISOString(),
  repo: 'local-guides-citation-velocity',
  status: errors.length || failed.length ? 'FAIL' : 'PASS',
  proof_layer: 'CONTAINER_BROWSERLESS_MOCK_BACKUP',
  is_real_browser_proof: false,
  browser_validation_substitute: false,
  reason: 'Fallback structural audit for browser-constrained containers. It backs up public click-audit intent with deterministic route fixtures; it does not prove layout geometry, JavaScript runtime behavior, screenshots, or deployed runtime.',
  contract_cases: (contract.checks || []).length,
  manifest_routes: (manifest.routes || []).length,
  checked_cases: results.length,
  failed_cases: failed.length,
  errors,
  warnings,
  limitations: [
    'no real Chromium launch',
    'no screenshots',
    'no getBoundingClientRect geometry',
    'no real console/request telemetry',
    'no deployed URL verification'
  ],
  results
};
const backup = {
  schema_version: '1.0',
  generated_at: report.generated_at,
  repo: report.repo,
  purpose: 'mock backup in lieu of unavailable browser proof for container validation only',
  source_files: {
    browser_contract: '_browser_suite_contract.json',
    route_manifest: '_public_route_manifest.json',
    fixture: 'data/mocks/browserless-route-audit-fixtures.json'
  },
  proof_layer: report.proof_layer,
  status: report.status,
  is_real_browser_proof: false,
  local_browser_validation_required: true,
  checked_cases: report.checked_cases,
  failed_cases: report.failed_cases,
  errors: report.errors,
  warnings: report.warnings,
  fixture_hashes: {
    browser_contract_sha256: sha256(fs.readFileSync(contractPath)),
    route_manifest_sha256: sha256(fs.readFileSync(manifestPath)),
    fixture_sha256: sha256(fs.readFileSync(fixturePath))
  }
};
ensureDir(outPath); fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');
ensureDir(backupPath); fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2) + '\n');
ensureDir(reportPath); fs.writeFileSync(reportPath, [
  '# Browserless Mock Backup Audit',
  '',
  `Status: ${report.status}`,
  `Checked cases: ${report.checked_cases}`,
  `Failed cases: ${report.failed_cases}`,
  '',
  'This is not real browser proof. It is a deterministic structural fallback for container validation when Chromium/deployed runtime proof is unavailable.',
  '',
  '## Limitations',
  ...report.limitations.map(x => `- ${x}`),
  '',
  '## Failures',
  ...(failed.length ? failed.map(r => `- ${r.id}: ${r.failures.join('; ')}`) : ['- None']),
  '',
  '## Warnings',
  ...(warnings.length ? warnings.slice(0, 100).map(w => `- ${w}`) : ['- None'])
].join('\n') + '\n');
if (report.status !== 'PASS') {
  console.error(`BROWSERLESS MOCK BACKUP FAIL: ${errors.length} errors, ${failed.length} failed cases`);
  process.exit(1);
}
console.log(`BROWSERLESS MOCK BACKUP PASS: ${results.length} cases; real browser proof still required locally.`);
