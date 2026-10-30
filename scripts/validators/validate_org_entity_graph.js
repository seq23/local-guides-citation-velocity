#!/usr/bin/env node
'use strict';
/**
* validate_org_entity_graph (the audit's validate_entity_graph; validate_entity_graph.js is the older LLM-export check): the served JSON-LD says exactly what entity.json says.
 *
 * Grid authority audit, 30 Oct 2026: sameAs pointed at the site's own /about and
 * /methodology, nothing declared a parent, and no repo checked any of it. The
 * rules live in scripts/lib/entity_graph_check.js; this runner applies them to
 * entity.json, to the derived node in scripts/lib/network_schema.js and to every
 * page in dist/, and replays the hostile fixtures so it cannot pass by reading
 * nothing. The same file and node checks run inside the network-crawler-contract
 * blocker (the release profile's HARD_FAIL cap of 40 is full), so drift blocks a
 * release; this runner adds the full served-tree sweep and the evidence file.
 *
 * Empty sameAs with profiles pending is a NAMED STOP, printed, not a failure:
 * creating the profile is the owner's login, and the weekly
 * entity-backlink-watch.yml promotes it the week it resolves.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const g = require('../lib/entity_graph_check');
const { organizationFromEntity } = require('../lib/network_schema');

const OUT = path.join(ROOT, 'artifacts', 'validation', 'org-entity-graph.json');
const errors = [];
const entityPath = path.join(ROOT, 'entity.json');
const regPath = path.join(ROOT, 'data', 'authority', 'verified_same_as_registry.json');
if (!fs.existsSync(entityPath)) errors.push('entity.json missing');
if (!fs.existsSync(regPath)) errors.push('data/authority/verified_same_as_registry.json missing');

let report = { validator: 'org-entity-graph', ok: false };
if (!errors.length) {
  const entity = JSON.parse(fs.readFileSync(entityPath, 'utf8'));
  const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  errors.push(...g.checkEntityFile(entity, registry));
  const node = organizationFromEntity(entity);
  const derived = g.checkPageHtml(`<script type="application/ld+json">${JSON.stringify(node)}</script>`, entity, 'network_schema');
  errors.push(...derived.errors);
  if (!derived.described) errors.push('network_schema:organization_node_not_described');
  const escaped = g.hostileFixtures(entity, registry);
  for (const name of escaped) errors.push(`hostile_fixture_passed:${name}`);
  // The weekly watch's self-heal planner, replayed on fixtures: it must remove a
  // dead profile, promote a live pending one, name a missing link-back, keep a
  // JS-rendered profile as unverifiable, and refuse to watch nothing.
  {
    const { planChanges } = require('../authority/entity_backlink_watch');
    const base = { ...entity, sameAs: ['https://dead.example/p', 'https://nolink.example/p', 'https://www.instagram.com/fixture'], profiles_pending: [{ platform: 'LinkedIn', url: 'https://live.example/p', owner_action: 'x', link_back_field: 'Website' }, { platform: 'Pinterest', url: 'https://notyet.example/p', owner_action: 'create it', link_back_field: 'Website' }] };
    const reg = { ...registry, records: base.sameAs.map((u) => ({ entity_id: entity['@id'], url: u, source_url: u, basis: 'THIRD_PARTY_PROFILE', status: 'VERIFIED' })) };
    const plan = planChanges(base, reg, [
      { url: 'https://dead.example/p', state: 'dead', http: 404 },
      { url: 'https://nolink.example/p', state: 'no_link_back', http: 200 },
      { url: 'https://www.instagram.com/fixture', state: 'unverifiable' },
      { url: 'https://live.example/p', state: 'live', http: 200 },
      { url: 'https://notyet.example/p', state: 'dead', http: 404 },
    ], '2026-10-30');
    const want = (ok, name) => { if (!ok) errors.push(`watch_fixture:${name}`); };
    want(!plan.entity.sameAs.includes('https://dead.example/p'), 'dead sameAs not removed');
    want(plan.registry.records.find((r) => r.url === 'https://dead.example/p').status === 'RETIRED', 'dead record not retired');
    want(plan.entity.sameAs.includes('https://live.example/p') && plan.registry.records.some((r) => r.url === 'https://live.example/p' && r.status === 'VERIFIED' && r.basis === 'THIRD_PARTY_PROFILE'), 'live pending not promoted');
    want(plan.stops.some((s) => s.includes('nolink.example') && s.includes('Website') === false && s.includes('Missing link-back')), 'missing link-back not a named stop');
    want(plan.actions.some((a) => a.kind === 'unverifiable' && a.url.includes('instagram')), 'JS-rendered profile not unverifiable');
    want(plan.entity.profiles_pending.length === 1 && plan.stops.some((s) => s.includes('create it')), 'unclaimed pending lost its owner action');
    want(g.checkEntityFile(plan.entity, plan.registry).length === 0, `healed entity fails its own contract: ${g.checkEntityFile(plan.entity, plan.registry).join(',')}`);
    want(planChanges({ ...entity, sameAs: [], profiles_pending: [] }, registry, [], '2026-10-30').errors.length > 0, 'watch over nothing passed');
  }
  const dist = path.resolve(ROOT, process.env.PAGES_OUT_DIR || 'dist');
  const tree = g.checkServedTree(dist, entity);
  errors.push(...tree.errors);
  const pending = entity.profiles_pending || [];
  report = {
    validator: 'org-entity-graph', ok: errors.length === 0,
    entity_id: entity['@id'], name: entity.name,
    sameAs: entity.sameAs, parentOrganization: entity.parentOrganization && entity.parentOrganization['@id'],
    subOrganizations: (entity.subOrganization || []).length,
    profiles_pending: pending.map((p) => ({ platform: p.platform, url: p.url, owner_action: p.owner_action })),
    pages_checked: tree.pages, pages_with_described_node: tree.described,
    hostile_fixtures_escaped: escaped,
    errors: errors.slice(0, 200), error_count: errors.length,
  };
  if (!(entity.sameAs || []).length && pending.length) {
    console.log('NAMED STOP (owner login): The Industry Guides has no third-party profile yet, so the Organization publishes no sameAs.');
    for (const p of pending) console.log(`  - ${p.platform}: ${p.owner_action}`);
  }
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
if (errors.length) {
  console.error(`ENTITY GRAPH FAIL (${errors.length}):`);
  for (const e of errors.slice(0, 40)) console.error(`- ${e}`);
  process.exit(1);
}
console.log(`ENTITY GRAPH PASS: ${report.pages_checked} served pages, ${report.pages_with_described_node} carry the described Organization; sameAs ${report.sameAs.length}, parent ${report.parentOrganization}, ${report.subOrganizations} sub-organizations, ${report.profiles_pending.length} pending profile(s).`);
