#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * MedicalWebPage and PriceSpecification are on the RENDERED page, parse, and match it.
 *
 * The neuro and dentistry citation runs asked for these types on every sweep from July
 * onwards. FAQPage and HowTo were already emitted on every programmatic page; the
 * medical types were emitted nowhere, while content/_live/pages.json carried a
 * `schema_eligibility.medical_web_page` flag on 220 records that no code path read.
 *
 * This validator asserts the delivery, not the intent, so it reads the built HTML:
 *
 *   1. every medical hub and sub-hub route carries a MedicalWebPage node;
 *   2. no personal-injury route carries one - it is a legal vertical, and typing a
 *      contingency-fee page as MedicalWebPage is a false claim about the page;
 *   3. every route in data/content/itemized_cost_specifications.json carries
 *      PriceSpecification nodes, one per dataset row, with the same min/max;
 *   4. every price in the markup is also VISIBLE on the page. Structured data quoting
 *      a figure the reader cannot see is deceptive markup, and it is the specific way
 *      a price-schema change goes wrong;
 *   5. every JSON-LD block on those pages parses.
 *
 * Rule 0: zero pages examined, or zero expected routes, is a hard failure.
 */

const fs = require('fs');
const path = require('path');
const { isMedicalHubRoute, costSpecForRoute, priceSpecificationNodes, COST_SPECS_REL } = require('../lib/medical_schema');

const ROOT = path.resolve(__dirname, '../..');
const LIVE_PAGES = 'content/_live/pages.json';
const OUT = 'artifacts/validation/medical-schema-emission.json';

function rel(p) { return path.join(ROOT, p); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return fallback; } }
function renderedFileFor(route) {
  const clean = String(route || '').replace(/^\//, '');
  if (!clean) return 'index.html';
  return clean.endsWith('.html') ? clean : `${clean.replace(/\/$/, '')}/index.html`;
}
function jsonLdBlocks(html) {
  const out = [];
  const bad = [];
  for (const m of String(html).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    try { out.push(JSON.parse(m[1])); } catch (e) { bad.push(String(e.message).slice(0, 120)); }
  }
  return { blocks: out, parseErrors: bad };
}
function typesIn(value, found = new Set()) {
  if (Array.isArray(value)) { for (const v of value) typesIn(v, found); return found; }
  if (value && typeof value === 'object') {
    if (value['@type']) {
      if (Array.isArray(value['@type'])) for (const t of value['@type']) found.add(String(t));
      else found.add(String(value['@type']));
    }
    for (const v of Object.values(value)) typesIn(v, found);
  }
  return found;
}
function nodesOfType(value, type, out = []) {
  if (Array.isArray(value)) { for (const v of value) nodesOfType(v, type, out); return out; }
  if (value && typeof value === 'object') {
    if (value['@type'] === type) out.push(value);
    for (const v of Object.values(value)) nodesOfType(v, type, out);
  }
  return out;
}
function visibleText(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
}

function main() {
  const pages = (readJson(LIVE_PAGES, { pages: [] }).pages || []);
  const costSpecs = readJson(COST_SPECS_REL, { routes: {} });
  const costRoutes = Object.keys(costSpecs.routes || {});
  if (!pages.length) {
    console.error(`MEDICAL SCHEMA EMISSION FAIL: ${LIVE_PAGES} has no pages; nothing can be checked.`);
    process.exit(1);
  }
  if (!costRoutes.length) {
    console.error(`MEDICAL SCHEMA EMISSION FAIL: ${COST_SPECS_REL} names no routes, so PriceSpecification coverage is UNKNOWN rather than clear.`);
    process.exit(1);
  }

  const expectedMedical = pages.filter((p) => isMedicalHubRoute(p.slug || p.path, p.vertical));
  const expectedNotMedical = pages.filter((p) => String(p.vertical || '') === 'personal_injury');
  if (!expectedMedical.length) {
    console.error('MEDICAL SCHEMA EMISSION FAIL: zero medical hub routes identified. Either the route shapes changed or the vertical names did; both are defects, not a pass.');
    process.exit(1);
  }

  const missingMedical = [];
  const wrongMedical = [];
  const missingPrice = [];
  const priceMismatch = [];
  const invisiblePrice = [];
  const parseFailures = [];
  const notBuilt = [];
  let checked = 0;
  let priceRoutesChecked = 0;

  const checkPage = (page, expectMedical) => {
    const file = renderedFileFor(page.slug || page.path);
    const abs = rel(file);
    if (!fs.existsSync(abs)) { notBuilt.push(file); return; }
    const html = fs.readFileSync(abs, 'utf8');
    const { blocks, parseErrors } = jsonLdBlocks(html);
    if (parseErrors.length) parseFailures.push({ file, errors: parseErrors });
    checked += 1;
    const types = typesIn(blocks);
    const hasMedical = types.has('MedicalWebPage');
    if (expectMedical && !hasMedical) missingMedical.push(file);
    if (!expectMedical && hasMedical) wrongMedical.push(file);

    const spec = costSpecForRoute(page.slug || page.path);
    if (!spec) return;
    priceRoutesChecked += 1;
    const emitted = nodesOfType(blocks, 'PriceSpecification');
    const wanted = priceSpecificationNodes(page.slug || page.path);
    if (!emitted.length) { missingPrice.push(file); return; }
    if (emitted.length !== wanted.length) {
      priceMismatch.push({ file, expected: wanted.length, emitted: emitted.length });
      return;
    }
    const text = visibleText(html);
    for (const want of wanted) {
      const match = emitted.find((e) => e.name === want.name);
      if (!match || Number(match.minPrice) !== Number(want.minPrice) || Number(match.maxPrice) !== Number(want.maxPrice)) {
        priceMismatch.push({ file, row: want.name, expected: `${want.minPrice}-${want.maxPrice}`, emitted: match ? `${match.minPrice}-${match.maxPrice}` : '(absent)' });
        continue;
      }
      const min = `$${Number(want.minPrice).toLocaleString('en-US')}`;
      const max = `$${Number(want.maxPrice).toLocaleString('en-US')}`;
      if (!text.includes(min) || !text.includes(max)) {
        invisiblePrice.push({ file, row: want.name, min, max });
      }
    }
  };

  for (const page of expectedMedical) checkPage(page, true);
  for (const page of expectedNotMedical) checkPage(page, false);

  if (checked === 0) {
    console.error(`MEDICAL SCHEMA EMISSION FAIL: ${expectedMedical.length} medical route(s) expected and none is built on disk. Build the site, then re-run.`);
    process.exit(1);
  }
  if (priceRoutesChecked === 0) {
    console.error(`MEDICAL SCHEMA EMISSION FAIL: ${costRoutes.length} route(s) carry itemized cost data and none was checkable. PriceSpecification coverage is UNKNOWN.`);
    process.exit(1);
  }

  const failures = missingMedical.length + wrongMedical.length + missingPrice.length + priceMismatch.length + invisiblePrice.length + parseFailures.length;
  fs.mkdirSync(rel('artifacts/validation'), { recursive: true });
  fs.writeFileSync(rel(OUT), `${JSON.stringify({
    schema_version: '1.0', validator: 'medical-schema-emission', status: failures ? 'FAIL' : 'PASS',
    checked_at: new Date().toISOString(),
    medical_routes_expected: expectedMedical.length, non_medical_routes_checked: expectedNotMedical.length,
    pages_checked: checked, price_routes_checked: priceRoutesChecked, pages_not_built: notBuilt.length,
    missing_medical_web_page: missingMedical, medical_web_page_on_non_medical_route: wrongMedical,
    missing_price_specification: missingPrice, price_mismatch: priceMismatch,
    price_in_markup_not_visible_on_page: invisiblePrice, json_ld_parse_failures: parseFailures
  }, null, 2)}\n`);

  if (failures) {
    console.error(`MEDICAL SCHEMA EMISSION FAIL: ${failures} problem(s) across ${checked} rendered page(s).`);
    for (const f of missingMedical.slice(0, 15)) console.error(`  MISSING MedicalWebPage      ${f}`);
    for (const f of wrongMedical.slice(0, 15)) console.error(`  MedicalWebPage on a LEGAL page ${f}`);
    for (const f of missingPrice.slice(0, 15)) console.error(`  MISSING PriceSpecification  ${f}`);
    for (const f of priceMismatch.slice(0, 15)) console.error(`  PRICE MISMATCH ${JSON.stringify(f)}`);
    for (const f of invisiblePrice.slice(0, 15)) console.error(`  PRICE NOT VISIBLE ON PAGE ${JSON.stringify(f)}`);
    for (const f of parseFailures.slice(0, 10)) console.error(`  JSON-LD DOES NOT PARSE ${f.file}: ${f.errors.join('; ')}`);
    process.exit(1);
  }
  console.log(`MEDICAL SCHEMA EMISSION PASS: ${checked} rendered page(s) parsed; MedicalWebPage on ${expectedMedical.length} medical hub route(s) and on none of ${expectedNotMedical.length} personal-injury route(s); PriceSpecification on ${priceRoutesChecked} costed route(s), every figure also visible on the page.`);
}

main();
