'use strict';
/**
 * The entity graph contract (grid authority audit, 30 Oct 2026).
 *
 * entity.json is the one statement of who theindustryguides.com is. This module
 * proves three things against it, as pure functions so the registered validator
 * (scripts/validators/validate_org_entity_graph.js) and the network-crawler-contract
 * blocker hold the site to ONE definition:
 *
 *   1. The file itself: sameAs lists third-party profiles only (nothing on our
 *      own host), each backed by a VERIFIED THIRD_PARTY_PROFILE record, and every
 *      such record is listed (two lists that must agree, checked both ways);
 *      parentOrganization is the Spry Labs entity home; each canonical guide is a
 *      subOrganization with its own @id; a pending profile carries the owner
 *      action and the exact field that holds the link back. Zero sameAs AND zero
 *      pending is a failure: an entity with nothing to reconcile against and
 *      nothing in flight is the defect the audit found.
 *   2. The published node (scripts/lib/network_schema.js) says exactly that.
 *   3. Every served page says exactly that: no Organization sameAs on our own
 *      host anywhere, the described node matches name/logo/description/parent/
 *      sub-organizations/sameAs, and inline publisher nodes carry the same
 *      sameAs. Hard-fails on zero pages read.
 *
 * hostileFixtures() replays known-bad inputs every run, so the check cannot pass
 * by reading nothing.
 */
const fs = require('fs');
const path = require('path');

const ENTITY_HOST = 'theindustryguides.com';
const ORG_ID = `https://${ENTITY_HOST}/#organization`;
const SPRY_LABS_ID = 'https://billionairehighperformancecoach.com/spry-labs#organization';
const ORG_TYPES = /^(Organization|LocalBusiness|Corporation|NewsMediaOrganization|ProfessionalService)$/;

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const sameList = (a, b) => JSON.stringify([...(a || [])].map(String)) === JSON.stringify([...(b || [])].map(String));
const isOrg = (n) => n && typeof n === 'object' && [].concat(n['@type'] || []).some((t) => ORG_TYPES.test(String(t)));
const arr = (v) => (v === undefined || v === null ? [] : [].concat(v));

function checkEntityFile(entity, registry) {
  const errors = [];
  if (!entity || typeof entity !== 'object') return ['entity_json_unreadable'];
  for (const k of ['@id', 'name', 'url', 'description']) if (!entity[k]) errors.push(`entity_missing_${k}`);
  if (!entity.logo || !entity.logo.url) errors.push('entity_missing_logo');
  if (entity['@id'] !== ORG_ID) errors.push(`entity_id_not_${ORG_ID}:${entity['@id']}`);
  if (!Array.isArray(entity.sameAs)) errors.push('entity_sameAs_not_a_list');
  const sameAs = arr(entity.sameAs).map(String);
  const pending = Array.isArray(entity.profiles_pending) ? entity.profiles_pending : [];
  if (!sameAs.length && !pending.length) errors.push('entity_has_zero_profiles: no sameAs and nothing pending; an entity with no external identity and none in flight is the defect');
  if (new Set(sameAs).size !== sameAs.length) errors.push('entity_sameAs_duplicate');
  for (const u of sameAs) {
    if (!/^https:\/\//.test(u)) errors.push(`entity_sameAs_not_https:${u}`);
    if (hostOf(u) === ENTITY_HOST) errors.push(`entity_sameAs_self_reference:${u}`);
  }
  const records = (registry && Array.isArray(registry.records)) ? registry.records : [];
  const verified = records.filter((r) => r && r.status === 'VERIFIED' && r.entity_id === entity['@id']);
  for (const r of records.filter((x) => x && x.status === 'VERIFIED')) {
    if (hostOf(r.url) === ENTITY_HOST) errors.push(`verified_record_self_reference:${r.url}`);
    if (r.basis !== 'THIRD_PARTY_PROFILE') errors.push(`verified_record_basis_not_third_party:${r.url}:${r.basis}`);
    if (hostOf(r.source_url) === ENTITY_HOST) errors.push(`verified_record_source_on_own_host:${r.source_url}`);
  }
  const verifiedUrls = new Set(verified.map((r) => String(r.url)));
  for (const u of sameAs) if (!verifiedUrls.has(u)) errors.push(`entity_sameAs_without_verified_record:${u}`);
  for (const u of verifiedUrls) if (!sameAs.includes(u)) errors.push(`verified_record_not_in_entity_sameAs:${u}`);
  for (const p of pending) {
    if (!p || !p.url || !p.platform) { errors.push('pending_profile_missing_url_or_platform'); continue; }
    if (hostOf(p.url) === ENTITY_HOST) errors.push(`pending_profile_self_reference:${p.url}`);
    if (sameAs.includes(p.url)) errors.push(`pending_profile_already_in_sameAs:${p.url}`);
    if (!p.owner_action) errors.push(`pending_profile_missing_owner_action:${p.url}`);
    if (!p.link_back_field) errors.push(`pending_profile_missing_link_back_field:${p.url}`);
  }
  if (entity.entity_parent !== 'spry-labs') errors.push(`entity_parent_not_spry_labs:${entity.entity_parent}`);
  if (!entity.parentOrganization || entity.parentOrganization['@id'] !== SPRY_LABS_ID) errors.push(`parentOrganization_not_spry_labs:${entity.parentOrganization && entity.parentOrganization['@id']}`);
  const subs = arr(entity.subOrganization);
  if (!subs.length) errors.push('entity_has_zero_subOrganizations');
  const seen = new Set();
  for (const s of subs) {
    const h = hostOf(s && s.url);
    if (!s || !s['@id'] || !s.name || !h) { errors.push(`subOrganization_incomplete:${JSON.stringify(s)}`); continue; }
    if (s['@id'] !== `https://${h}/#organization`) errors.push(`subOrganization_id_not_on_its_host:${s['@id']}`);
    if (h === ENTITY_HOST) errors.push(`subOrganization_is_self:${s['@id']}`);
    if (seen.has(s['@id'])) errors.push(`subOrganization_duplicate:${s['@id']}`);
    seen.add(s['@id']);
  }
  return errors;
}

/** What the described Organization node must carry, derived from entity.json. */
function expectedNode(entity) {
  return {
    '@id': entity['@id'],
    name: entity.name,
    logoUrl: entity.logo && entity.logo.url,
    description: entity.description,
    sameAs: arr(entity.sameAs).map(String),
    parentId: entity.parentOrganization && entity.parentOrganization['@id'],
    subIds: arr(entity.subOrganization).map((s) => s['@id']),
  };
}

function checkNode(node, exp, where) {
  const errors = [];
  if (node.name !== exp.name) errors.push(`${where}:name:${node.name}`);
  const logoUrl = node.logo && (node.logo.url || node.logo);
  if (logoUrl !== exp.logoUrl) errors.push(`${where}:logo:${logoUrl}`);
  if (node.description !== exp.description) errors.push(`${where}:description`);
  if (!sameList(arr(node.sameAs), exp.sameAs)) errors.push(`${where}:sameAs:${JSON.stringify(arr(node.sameAs))}`);
  const pid = node.parentOrganization && node.parentOrganization['@id'];
  if (pid !== exp.parentId) errors.push(`${where}:parentOrganization:${pid}`);
  const subIds = arr(node.subOrganization).map((s) => s && s['@id']);
  if (!sameList(subIds, exp.subIds)) errors.push(`${where}:subOrganization:${JSON.stringify(subIds)}`);
  return errors;
}

function jsonLdBlocks(html) {
  const out = [];
  const re = /<script\b[^>]*type=(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) { try { out.push(JSON.parse(m[2])); } catch { /* malformed blocks are another validator's job */ } }
  return out;
}

/** Errors for one served page, and whether it carried the described node. */
function checkPageHtml(html, entity, where = 'page') {
  const exp = expectedNode(entity);
  const errors = [];
  let described = false;
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== 'object') return;
    if (isOrg(n)) {
      for (const u of arr(n.sameAs)) if (hostOf(String(u)) === ENTITY_HOST) errors.push(`${where}:sameAs_self_reference:${u}`);
      if (n['@id'] === exp['@id'] && n.name) { described = true; errors.push(...checkNode(n, exp, `${where}:organization`)); }
      else if (!n['@id'] && n.name === exp.name && !sameList(arr(n.sameAs), exp.sameAs)) errors.push(`${where}:publisher_sameAs:${JSON.stringify(arr(n.sameAs))}`);
    }
    for (const v of Object.values(n)) walk(v);
  };
  for (const block of jsonLdBlocks(html)) walk(block);
  return { errors, described };
}

function walkHtml(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkHtml(p));
    else if (ent.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/** Every served page under distDir. Zero pages, or a homepage without the node, fails. */
function checkServedTree(distDir, entity) {
  const errors = [];
  if (!fs.existsSync(distDir)) return { errors: [`served_tree_missing:${distDir}`], pages: 0, described: 0 };
  const files = walkHtml(distDir);
  let described = 0;
  for (const f of files) {
    const rel = path.relative(distDir, f);
    const r = checkPageHtml(fs.readFileSync(f, 'utf8'), entity, rel);
    errors.push(...r.errors);
    if (r.described) described += 1;
    if (rel === 'index.html' && !r.described) errors.push('index.html:organization_node_missing');
  }
  if (!files.length) errors.push(`served_tree_has_zero_pages:${distDir}`);
  return { errors, pages: files.length, described };
}

/** Known-bad inputs that must each fail. Returns the names of any that passed. */
function hostileFixtures(entity, registry) {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const escaped = [];
  const fileCase = (name, mutate) => {
    const e = clone(entity); const r = clone(registry || { records: [] });
    mutate(e, r);
    if (!checkEntityFile(e, r).length) escaped.push(name);
  };
  fileCase('self-referential sameAs', (e, r) => {
    e.sameAs = [`https://${ENTITY_HOST}/about`];
    r.records = [...(r.records || []), { entity_id: e['@id'], url: `https://${ENTITY_HOST}/about`, source_url: `https://${ENTITY_HOST}/about`, basis: 'THIRD_PARTY_PROFILE', status: 'VERIFIED' }];
  });
  fileCase('sameAs with no verified record', (e) => { e.sameAs = ['https://www.linkedin.com/company/not-verified-fixture']; e.profiles_pending = []; });
  fileCase('verified record missing from sameAs', (e, r) => { r.records = [...(r.records || []), { entity_id: e['@id'], url: 'https://www.linkedin.com/company/fixture', source_url: 'https://www.linkedin.com/company/fixture', basis: 'THIRD_PARTY_PROFILE', status: 'VERIFIED' }]; e.sameAs = []; });
  fileCase('zero sameAs and zero pending', (e) => { e.sameAs = []; e.profiles_pending = []; });
  fileCase('parent not Spry Labs', (e) => { e.parentOrganization = { '@id': 'https://example.com/#organization' }; });
  fileCase('pending profile without owner action', (e) => { e.profiles_pending = [{ platform: 'X', url: 'https://x.com/fixture', link_back_field: 'bio' }]; });
  fileCase('subOrganization off its own host', (e) => { e.subOrganization = [{ '@id': 'https://other.example/#organization', name: 'Fixture', url: 'https://fixture.example/' }]; });
  fileCase('no subOrganizations', (e) => { e.subOrganization = []; });

  const node = require('./network_schema').organizationFromEntity(entity);
  const page = (n) => `<html><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [n] })}</script></html>`;
  if (!checkPageHtml(page(node), entity).described || checkPageHtml(page(node), entity).errors.length) escaped.push('the published node itself does not pass (fixture is broken)');
  const pageCase = (name, mutate) => { const n = clone(node); mutate(n); if (!checkPageHtml(page(n), entity).errors.length) escaped.push(name); };
  pageCase('page carries a self-referential sameAs', (n) => { n.sameAs = [`https://${ENTITY_HOST}/methodology`]; });
  pageCase('page carries the old network name', (n) => { n.name = 'The Industry Guides Network'; });
  pageCase('page drops parentOrganization', (n) => { delete n.parentOrganization; });
  pageCase('page carries the old brand-only graph', (n) => { delete n.subOrganization; });
  pageCase('page logo drifts', (n) => { n.logo = { url: 'https://example.com/logo.png' }; });
  pageCase('inline publisher keeps a stale sameAs', (n) => { n.publisherFixture = { '@type': 'Organization', name: entity.name, sameAs: ['https://stale.example/profile'] }; });
  return escaped;
}

module.exports = { ENTITY_HOST, ORG_ID, SPRY_LABS_ID, checkEntityFile, expectedNode, checkPageHtml, checkServedTree, hostileFixtures, jsonLdBlocks, hostOf };
