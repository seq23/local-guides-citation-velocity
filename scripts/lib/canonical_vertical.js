'use strict';
// The one place an emitted `vertical` value is decided. Every writer of a file
// another system reads (feeds, release candidates, fanout release files, the
// citation runway) passes its vertical through toCanonicalVertical(), so a
// source spelling such as "pi", "personal_injury" or "uscis" never leaves the
// repo. The table is data/contracts/velocity_vertical_aliases.json, mirrored
// from local-guides-generator; validate_canonical_vertical_ids.js reads the
// same table and the emitted files.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const TABLE_REL = 'data/contracts/velocity_vertical_aliases.json';
let cache = null;
function table(rootDir = ROOT) {
  if (typeof rootDir !== 'string') rootDir = ROOT;
  if (cache && cache.root === rootDir) return cache;
  const abs = path.join(rootDir, TABLE_REL);
  if (!fs.existsSync(abs)) throw new Error(`canonical_vertical: missing ${TABLE_REL}`);
  const doc = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const ids = new Set(doc.canonical_ids || []);
  if (!ids.size) throw new Error(`canonical_vertical: ${TABLE_REL} has no canonical_ids`);
  for (const [alias, id] of Object.entries(doc.aliases || {})) {
    if (!ids.has(id)) throw new Error(`canonical_vertical: alias ${alias} -> ${id} is not a canonical id`);
  }
  cache = { root: rootDir, ids, aliases: doc.aliases || {} };
  return cache;
}

/** Canonical id for a known spelling, or null when the value names no vertical. */
function toCanonicalVertical(value, rootDir = ROOT) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return null;
  const t = table(rootDir);
  if (t.ids.has(raw)) return raw;
  return t.aliases[raw] || t.aliases[raw.replace(/_/g, '-')] || t.aliases[raw.replace(/[-_]/g, ' ')] || null;
}

function canonicalVerticalIds(rootDir = ROOT) { return [...table(rootDir).ids]; }
function isCanonicalVertical(value, rootDir = ROOT) { return table(rootDir).ids.has(String(value)); }

module.exports = { TABLE_REL, toCanonicalVertical, canonicalVerticalIds, isCanonicalVertical };
