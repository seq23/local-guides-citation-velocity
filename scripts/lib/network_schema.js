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
 * Since 2026-10-26 it holds two FIRST_PARTY_ENTITY_PAGE records (/about,
 * /methodology), each verified live, which closes Search Readiness c1 on all
 * 2,136 pages. The umbrella brand still has no owned external profile - that
 * search and its result are recorded in the registry so nobody repeats it - and
 * inventing one is still the first item in the identity registry's own
 * `prohibited` list. The records are the ONLY source: a sameAs written into
 * network_identity_registry.json would be a second one this function overrides.
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

function networkSchemaNodes() {
  const registry = loadRegistry();
  const org = registry.organization ? { ...registry.organization } : null;
  if (org) {
    const same = verifiedSameAs(org['@id']);
    if (same.length) org.sameAs = same;
  }
  return [org, registry.website].filter(Boolean);
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

module.exports = { loadRegistry, verifiedSameAs, networkSchemaNodes, mergeSchema };
