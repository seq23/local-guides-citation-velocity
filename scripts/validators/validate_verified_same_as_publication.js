#!/usr/bin/env node
'use strict';
/**
 * Registering a VERIFIED sameAs record publishes it on the page.
 *
 * Five validators policed data/authority/verified_same_as_registry.json and no
 * generator read it, so the registry was write-only: a verified profile could be
 * registered and still appear on no page, and "every sameAs URL must be
 * registered here before publication" governed nothing. A spec no code reads is a
 * wish, so this test reads it.
 *
 * It proves the path both ways with a temporary record, and restores the file.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const REG = path.join(ROOT, 'data', 'authority', 'verified_same_as_registry.json');
const ORG_ID = 'https://theindustryguides.com/#organization';

function freshSchema() {
  for (const k of Object.keys(require.cache)) if (/scripts[\\/](lib[\\/])?(network_schema|served_head_contract)\.js$/.test(k)) delete require.cache[k];
  return require('../lib/network_schema');
}

const original = fs.readFileSync(REG, 'utf8');
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  ${name}`); }
  catch (e) { failures += 1; console.error(`FAIL  ${name}: ${e.message}`); }
};

try {
  // 1. As shipped: no records, so no page may carry a sameAs.
  const base = JSON.parse(original);
  check('no records today, so the published Organization has no sameAs', () => {
    assert.deepStrictEqual(base.records, [], 'this test assumes the registry ships empty');
    const org = freshSchema().networkSchemaNodes()[0];
    assert.ok(!org.sameAs, 'an empty registry must publish no sameAs');
  });

  // 2. A complete VERIFIED record is published.
  const verified = JSON.parse(original);
  verified.records = [{
    entity_id: ORG_ID,
    url: 'https://example.invalid/the-industry-guides',
    source_url: 'https://example.invalid/proof',
    verified_at: '2026-10-25',
    recheck_by: '2027-04-25',
    status: 'VERIFIED'
  }];
  check('a complete VERIFIED record reaches the published Organization', () => {
    fs.writeFileSync(REG, JSON.stringify(verified, null, 2) + '\n');
    const org = freshSchema().networkSchemaNodes()[0];
    assert.deepStrictEqual(org.sameAs, ['https://example.invalid/the-industry-guides']);
  });

  // 3. The schema a page actually renders carries it.
  check('mergeSchema puts the sameAs on the node a page renders', () => {
    const { mergeSchema } = freshSchema();
    const graph = mergeSchema({ '@type': 'Article', '@id': 'https://theindustryguides.com/x#article' })['@graph'];
    const org = graph.find((n) => n['@id'] === ORG_ID);
    assert.ok(org, 'the Organization node must be in the graph');
    assert.deepStrictEqual(org.sameAs, ['https://example.invalid/the-industry-guides']);
  });

  // 4. An incomplete record is NOT published: the registry names its own
  // required fields, and a record missing one is not verified in that sense.
  check('a record missing a required field is not published', () => {
    const partial = JSON.parse(original);
    partial.records = [{ entity_id: ORG_ID, url: 'https://example.invalid/partial', status: 'VERIFIED' }];
    fs.writeFileSync(REG, JSON.stringify(partial, null, 2) + '\n');
    const org = freshSchema().networkSchemaNodes()[0];
    assert.ok(!org.sameAs, 'an incomplete record must not be published');
  });

  // 5. A RETIRED record is not published.
  check('a RETIRED record is not published', () => {
    const retired = JSON.parse(original);
    retired.records = [{ ...verified.records[0], status: 'RETIRED' }];
    fs.writeFileSync(REG, JSON.stringify(retired, null, 2) + '\n');
    const org = freshSchema().networkSchemaNodes()[0];
    assert.ok(!org.sameAs, 'a retired record must not be published');
  });
} finally {
  fs.writeFileSync(REG, original);
  assert.strictEqual(fs.readFileSync(REG, 'utf8'), original, 'the registry must be restored');
}

if (failures) {
  console.error(`\nverified-same-as publication: ${failures} failure(s)`);
  process.exit(1);
}
console.log('\nverified-same-as publication: the registry is read, not just policed (5 checks).');
