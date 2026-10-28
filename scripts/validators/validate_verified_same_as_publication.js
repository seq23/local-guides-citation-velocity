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
  // 1. As shipped: the registry carries real records and every one of them is
  // on the page. This pin used to assert the registry shipped EMPTY, which was
  // true until 2026-10-26 and is the weaker statement either way - an empty
  // registry proves the publication path only in the negative. It now asserts
  // the published sameAs is exactly the set of complete VERIFIED records for
  // this entity, so a record that is registered and not published, or published
  // and not registered, both fail here.
  const base = JSON.parse(original);
  check('every complete VERIFIED record for this entity is published, and nothing else is', () => {
    const required = base.required_for_verified;
    assert.ok(Array.isArray(required) && required.length, 'the registry must state its required fields');
    const bases = Object.keys(base.allowed_bases || {});
    assert.ok(bases.length, 'the registry must declare what a basis may be');
    const expected = [...new Set((base.records || [])
      .filter((r) => r.status === 'VERIFIED' && r.entity_id === ORG_ID)
      .filter((r) => required.every((k) => r[k]) && bases.includes(r.basis))
      .map((r) => r.url))];
    assert.ok(expected.length, 'the registry must ship at least one publishable record: Search Readiness c1 fails the whole site when the Organization has no sameAs');
    const org = freshSchema().networkSchemaNodes()[0];
    assert.deepStrictEqual(org.sameAs, expected, 'the published sameAs must be exactly the publishable records');
  });

  // 1b. Every shipped record is complete and honest about its basis. Without
  // this, "VERIFIED" is a string a record can write about itself.
  check('every shipped VERIFIED record is complete and declares an allowed basis', () => {
    const required = base.required_for_verified;
    const bases = Object.keys(base.allowed_bases || {});
    const host = String(base.entity_host || 'theindustryguides.com');
    const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
    for (const r of (base.records || []).filter((x) => x.status === 'VERIFIED')) {
      for (const k of required) assert.ok(r[k], `record ${r.url} is missing ${k}`);
      assert.ok(bases.includes(r.basis), `record ${r.url} claims basis ${r.basis}`);
      if (r.basis === 'FIRST_PARTY_ENTITY_PAGE') {
        assert.strictEqual(hostOf(r.url), host, `first-party record ${r.url} is not on ${host}`);
        assert.strictEqual(hostOf(r.source_url), host, `first-party source ${r.source_url} is not on ${host}`);
      }
      if (r.basis === 'THIRD_PARTY_PROFILE') {
        assert.notStrictEqual(hostOf(r.source_url), host, `third-party record ${r.url} cites our own host as proof`);
      }
    }
  });

  // 1c. The identity registry must not carry its own sameAs. It did for part of
  // this change, and the derivation silently overrode it - a second source of
  // truth that agrees today and drifts tomorrow.
  check('network_identity_registry.json does not hand-write a sameAs', () => {
    const identity = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'network', 'network_identity_registry.json'), 'utf8'));
    assert.ok(!('sameAs' in (identity.organization || {})), 'sameAs belongs in the verified registry, which is what network_schema.js reads');
  });

  // 2. A complete VERIFIED record is published.
  const verified = JSON.parse(original);
  verified.records = [{
    entity_id: ORG_ID,
    url: 'https://example.invalid/the-industry-guides',
    source_url: 'https://example.invalid/proof',
    verified_at: '2026-10-25',
    recheck_by: '2027-04-25',
    basis: 'THIRD_PARTY_PROFILE',
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

  // 4b. A record whose basis is not one the registry allows is not published:
  // `basis` is in required_for_verified, so without this it would be a field
  // that must be present and may say anything.
  check('a record claiming an unknown basis is not published', () => {
    const bogus = JSON.parse(original);
    bogus.records = [{ ...verified.records[0], basis: 'BECAUSE_I_SAID_SO' }];
    fs.writeFileSync(REG, JSON.stringify(bogus, null, 2) + '\n');
    const org = freshSchema().networkSchemaNodes()[0];
    assert.ok(!org.sameAs, 'an unrecognised basis must not be published');
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
console.log('\nverified-same-as publication: the registry is read, not just policed (8 checks).');
