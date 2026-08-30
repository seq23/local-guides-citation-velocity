#!/usr/bin/env node
'use strict';
/**
 * The link between the rich-page generator and the rich-page contract.
 *
 * Velocity Content Release went red on 2026-08-30 with
 *   rich_page_missing_block:/dentistry/guides/dental-bridge-vs-implant-which-is-better/:why this page exists
 * on a page the release had just built correctly.
 *
 * validate_rich_new_page_contract.js asserted the literal headings
 * "direct answer", "source basis" and "why this page exists".
 * scripts/lib/rich_new_page_blocks.js later rewrote those headings into plainer
 * English - "Where the answer comes from", "Why this question is worth getting
 * right" - and nothing connected the two lists. Every rich page built from that
 * moment on was incapable of satisfying the contract.
 *
 * It stayed invisible for weeks because of the second half of the defect: the
 * contract grades only the pages a release actually created, the 2/day new-URL
 * ceiling meant it created none, and grading zero pages prints PASS. The break
 * surfaced the first morning the ceiling let two pages through.
 *
 * So this validator does not wait for a page to be built. It generates one for
 * every rich page type and every vertical, in memory, and proves that each block
 * role the contract requires is actually emitted. A heading may be rewritten
 * freely; a role may not disappear.
 *
 * Zero-item rule: it hard-fails if it extracted no required roles from the
 * contract, or generated no sections, rather than passing on an empty loop.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTRACT = 'scripts/validators/validate_rich_new_page_contract.js';
const {buildRichSections, labels, VERTICALS} = require(path.join(ROOT, 'scripts/lib/rich_new_page_blocks.js'));

const errors = [];
const contractSource = fs.readFileSync(path.join(ROOT, CONTRACT), 'utf8');

// Read the required roles out of the contract itself, so this cannot drift into
// a third opinion about what the required set is.
const required = [...contractSource.matchAll(/\{\s*role:\s*'([a-z_]+)'\s*,\s*legacy:/g)].map((m) => m[1]);
if (!required.length) {
  console.error(`[rich-block-contract-link] FAIL: could not read any required block role out of ${CONTRACT}. Either the contract was rewritten or this check no longer reaches what it governs; it must not pass on an empty list.`);
  process.exit(1);
}

const types = Object.keys(labels || {});
const verticals = Array.isArray(VERTICALS) ? VERTICALS : Object.keys(VERTICALS || {});
if (!types.length || !verticals.length) {
  console.error('[rich-block-contract-link] FAIL: no rich page types or verticals to generate; nothing was exercised.');
  process.exit(1);
}

let generated = 0;
for (const richType of types) {
  for (const vertical of verticals) {
    const sections = buildRichSections({
      item: {query: 'What should I know about this decision?', why_worth_building: 'measured demand'},
      route: `/${vertical}/guides/contract-link-probe/`,
      vertical,
      richType,
      date: '2026-01-01',
    });
    if (!Array.isArray(sections) || !sections.length) {
      errors.push(`${richType}/${vertical}: generator produced no sections`);
      continue;
    }
    generated += 1;
    const roles = new Set(sections.map((s) => s && s.block_role).filter(Boolean));
    for (const role of required) {
      if (!roles.has(role)) {
        errors.push(`${richType}/${vertical}: the contract requires block role "${role}" and the generator does not emit it (emitted: ${[...roles].join(', ') || 'none'})`);
      }
    }
  }
}

if (generated === 0) {
  errors.push('no rich page was generated, so no block role was proven; this check examined zero items');
}

const report = {
  schema_version: '1.0',
  validator: 'rich-block-contract-link',
  status: errors.length ? 'FAIL' : 'PASS',
  contract: CONTRACT,
  required_roles: required,
  rich_page_types: types.length,
  verticals: verticals.length,
  generated_pages: generated,
  errors,
  checked_at: new Date().toISOString(),
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), {recursive: true});
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/rich-block-contract-link.json'), `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(`[rich-block-contract-link] FAIL: ${errors.length} problem(s)`);
  for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`[rich-block-contract-link] PASS: ${required.length} required role(s) (${required.join(', ')}) proven against ${generated} generated page(s) across ${types.length} rich page type(s) x ${verticals.length} vertical(s)`);
