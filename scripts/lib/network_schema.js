'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const REGISTRY = path.join(ROOT, 'data', 'network', 'network_identity_registry.json');

function loadRegistry() {
  return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
}

function networkSchemaNodes() {
  const registry = loadRegistry();
  return [registry.organization, registry.website].filter(Boolean);
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

module.exports = { loadRegistry, networkSchemaNodes, mergeSchema };
