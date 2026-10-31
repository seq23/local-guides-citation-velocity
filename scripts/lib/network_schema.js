'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY = path.join(ROOT, 'data', 'network', 'network_identity_registry.json');

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

/**
 * The VERIFIED sameAs URLs for an entity, from the registry that already governs
 * them (data/authority/verified_same_as_registry.json).
 *
 * Until 2026-10-25 five validators POLICED that file and no generator READ it, so
 * registering a verified profile put it on no page: the registry was write-only
 * and the rule "every sameAs URL must be registered here before publication" was
 * a wish. This is the path from a registered record to the published node.
 *
 * The two FIRST_PARTY_ENTITY_PAGE records (/about, /methodology) of 26 Oct
 * were retired on 30 Oct 2026: sameAs is third-party profiles only, listed in
 * entity.json, and organizationFromEntity() below publishes the intersection.
 *
 * The required-field list comes from the registry's own `required_for_verified`,
 * not a copy of it here. It was a copy, and it drifted the moment the registry
 * added `basis`: a record could declare a field required and still publish
 * without it, which is the write-only registry defect this whole path exists to
 * end, one level down.
 */
function verifiedSameAs(entityId) {
  const registry = loadRegistry();
  const rel = registry.verified_same_as_registry || 'data/authority/verified_same_as_registry.json';
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  let registryFile;
  try { registryFile = JSON.parse(fs.readFileSync(abs, 'utf8')); } catch { return []; }
  const required = Array.isArray(registryFile.required_for_verified) && registryFile.required_for_verified.length
    ? registryFile.required_for_verified
    : ['entity_id', 'url', 'source_url', 'verified_at', 'recheck_by'];
  const allowedBases = Object.keys(registryFile.allowed_bases || {});
  const records = registryFile.records;
  if (!Array.isArray(records)) return [];
  return [...new Set(records
    .filter((r) => r && r.status === 'VERIFIED' && r.entity_id === entityId)
    // The registry states its own required fields; a record missing one is not
    // verified in the sense the registry means, so it is not published.
    .filter((r) => required.every((k) => r[k]))
    // And when the registry declares what a basis may be, a record claiming one
    // outside that list is not verified either - otherwise `basis` would be a
    // field that had to be present and could say anything.
    .filter((r) => !allowedBases.length || allowedBases.includes(r.basis))
    .map((r) => String(r.url)))];
}

const ENTITY_FILE = path.join(ROOT, 'entity.json');

function loadEntity() {
  return JSON.parse(fs.readFileSync(ENTITY_FILE, 'utf8'));
}

const REVIEWER_REGISTRY = path.join(ROOT, 'data', 'authority', 'reviewer_registry.json');

/**
 * The editorial byline this corpus is attributed to, read from the one registry
 * that already declares it (data/authority/reviewer_registry.json
 * fallback_byline - the same field scripts/apply_ymyl_attribution.mjs writes
 * onto every page).
 *
 * entity.json's founder_note states that this publisher "speaks as an
 * organisation byline (The Industry Guides Editorial Team)". So a no-@id
 * Organization node carrying that masthead IS this entity by another route: it
 * keeps its own name, and it must carry the entity's VERIFIED sameAs.
 *
 * It is read here rather than copied into each caller because the fixer
 * (scripts/lib/served_head_contract.js) and the contract that proves it
 * (scripts/lib/entity_graph_check.js) each kept their own list of names that
 * mean "this entity", and neither list named the masthead. That is why Search
 * Readiness c1 stayed red on 2,100+ pages after the sameAs itself was published
 * on 31 Oct 2026 (#247): the audit reads the FIRST Organization-shaped node in
 * the graph, which on these pages is the Article's author - the masthead.
 */
function editorialBylineName() {
  try {
    const registry = JSON.parse(fs.readFileSync(REVIEWER_REGISTRY, 'utf8'));
    const name = registry && registry.fallback_byline && registry.fallback_byline.name;
    return name ? String(name) : null;
  } catch { return null; }
}

/**
 * Names on a no-@id Organization node that mean "this entity under an older or
 * alias name": they are renamed to entity.name and carry its sameAs. The
 * masthead above is deliberately NOT one of these - renaming it would strip the
 * accountable byline data/governance/ymyl_attribution_ledger.json records.
 */
function entityAliasNames(node) {
  const n = node || organizationFromEntity();
  return new Set([n.name, ...[].concat(n.alternateName || [])].filter(Boolean).map(String));
}

/**
 * The published Organization node, built from entity.json (30 Oct 2026 authority
 * audit). entity.json is the one statement of the entity; the identity registry
 * no longer carries an organization of its own, so there is no second copy to
 * drift. sameAs is entity.json's list INTERSECTED with the VERIFIED records, so a
 * URL written into entity.json without a verified record still cannot publish,
 * and scripts/lib/entity_graph_check.js fails the build when the two disagree.
 * An empty list publishes no sameAs key at all: the pending profiles wait in
 * entity.json.profiles_pending as a named stop, never as a self-reference.
 */
function organizationFromEntity(entity = loadEntity()) {
  const verified = new Set(verifiedSameAs(entity['@id']));
  const org = {
    '@type': 'Organization',
    '@id': entity['@id'],
    name: entity.name,
    alternateName: entity.alternateName,
    url: entity.url,
    logo: entity.logo,
    description: entity.description,
    publishingPrinciples: entity.publishingPrinciples,
  };
  // The parent is a REFERENCE by @id only, never a name: theindustryguides.com
  // never names Spry Labs on a page (owner rule, 12 Oct 2026, enforced on dist/
  // by scripts/lib/brand_separation.js), and the 30 Oct 2026 grid decision to
  // point side businesses at the Spry Labs entity home is met by the @id link,
  // which the parent's own page describes.
  if (entity.parentOrganization && entity.parentOrganization['@id']) {
    org.parentOrganization = { '@id': entity.parentOrganization['@id'] };
  }
  const subs = (entity.subOrganization || []).map((s) => ({ '@type': 'Organization', '@id': s['@id'], name: s.name, url: s.url }));
  if (subs.length) {
    org.subOrganization = subs;
    org.brand = subs.map((s) => ({ '@type': 'Brand', name: s.name, url: s.url }));
  }
  const same = (entity.sameAs || []).map(String).filter((u) => verified.has(u));
  if (same.length) org.sameAs = same;
  for (const k of Object.keys(org)) if (org[k] === undefined || org[k] === null) delete org[k];
  return org;
}

function networkSchemaNodes() {
  const registry = loadRegistry();
  return [organizationFromEntity(), registry.website].filter(Boolean);
}

function mergeSchema(input) {
  const nodes = [];
  const add = (value) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(add);
    if (value['@graph'] && Array.isArray(value['@graph'])) return value['@graph'].forEach(add);
    nodes.push(value);
  };
  add(input);
  for (const node of networkSchemaNodes()) {
    const id = node['@id'];
    if (!id || !nodes.some((entry) => entry && entry['@id'] === id)) nodes.push(node);
  }
  return { '@context':'https://schema.org', '@graph':nodes.map((node) => {
    if (!node || typeof node !== 'object') return node;
    const copy = { ...node };
    delete copy['@context'];
    return copy;
  }) };
}

module.exports = { loadRegistry, loadEntity, ENTITY_FILE, verifiedSameAs, organizationFromEntity, networkSchemaNodes, mergeSchema, editorialBylineName, entityAliasNames };
