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
 * It holds no records today, so every page's Organization ships without sameAs
 * and Search Readiness c1 reports it. That is the honest state: the umbrella
 * brand has no owned external profile, and inventing one is the first item in the
 * identity registry's own `prohibited` list. Register one record here and it
 * appears on all 2,136 pages on the next build, with no code change.
 */
function verifiedSameAs(entityId) {
  const registry = loadRegistry();
  const rel = registry.verified_same_as_registry || 'data/authority/verified_same_as_registry.json';
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  let records;
  try { records = JSON.parse(fs.readFileSync(abs, 'utf8')).records; } catch { return []; }
  if (!Array.isArray(records)) return [];
  const required = ['entity_id', 'url', 'source_url', 'verified_at', 'recheck_by'];
  return [...new Set(records
    .filter((r) => r && r.status === 'VERIFIED' && r.entity_id === entityId)
    // The registry states its own required fields; a record missing one is not
    // verified in the sense the registry means, so it is not published.
    .filter((r) => required.every((k) => r[k]))
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
