#!/usr/bin/env node
'use strict';
/**
 * Derive data/schema/schemaorg_vocab.json from the official schema.org release
 * (https://schema.org/version/latest/schemaorg-current-https.jsonld).
 *
 * The structured-data check in validate_medical_schema_emission.js needs to know
 * which types exist, what they inherit from, and which properties each type may
 * carry - the same questions validator.schema.org answers. CI cannot call that
 * service (it answers automated clients with a CAPTCHA), so the vocabulary is
 * vendored here, reduced to class -> superclasses and property -> domain types.
 *
 * Usage: node scripts/schema/build_schemaorg_vocab_subset.js <schemaorg-current-https.jsonld>
 */
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('usage: build_schemaorg_vocab_subset.js <schemaorg-current-https.jsonld>'); process.exit(2); }
const graph = JSON.parse(fs.readFileSync(src, 'utf8'))['@graph'];
if (!Array.isArray(graph) || graph.length < 1000) { console.error('not a schema.org release graph'); process.exit(1); }
const strip = (id) => String(id).replace(/^schema:/, '');
const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map((x) => strip(x['@id']));
const classes = {};
const properties = {};
for (const node of graph) {
  const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
  const id = strip(node['@id']);
  if (types.includes('rdf:Property')) { properties[id] = ids(node['schema:domainIncludes']).sort(); continue; }
  if (types.includes('rdfs:Class') || types.some((t) => String(t).startsWith('schema:'))) classes[id] = ids(node['rdfs:subClassOf']).sort();
}
const sortObj = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const out = { schema_version: '1.0', source: 'https://schema.org/version/latest/schemaorg-current-https.jsonld', generated_by: 'scripts/schema/build_schemaorg_vocab_subset.js', class_count: Object.keys(classes).length, property_count: Object.keys(properties).length, classes: sortObj(classes), properties: sortObj(properties) };
const dest = path.resolve(__dirname, '../../data/schema/schemaorg_vocab.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, `${JSON.stringify(out)}\n`);
console.log(`schema.org vocabulary: ${out.class_count} classes, ${out.property_count} properties -> ${path.relative(process.cwd(), dest)}`);
