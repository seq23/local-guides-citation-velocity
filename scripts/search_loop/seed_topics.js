#!/usr/bin/env node
'use strict';
/**
 * Feeds the search loop's FIND stage from what this repo already measures.
 *
 * search-outcomes-weekly.yml runs scripts/search_console/free_discovery.py every
 * Wednesday and commits data/discovery/<ISO-week>/<property>.json: the queries each
 * canonical guide site already gets Search Console impressions for ("seeds"). The
 * engine (seq23/search-loop) only reads `topics` from search-loop.config.json, so
 * this rewrites `topics` as: each vertical's base topics plus its top measured seeds,
 * interleaved in vertical order (Memphis senior care first, owner ruling 1 Nov 2026).
 * The engine then expands them through Google/Bing autocomplete itself, so nothing
 * here is duplicated - this file only chooses the seeds.
 *
 * Deterministic: the same discovery week gives the same topics. Exit 0 always prints
 * one census line; a missing discovery week is a named note, never silent.
 *
 *   node scripts/search_loop/seed_topics.js [--config search-loop.config.json] [--check]
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const cfgRel = args.includes('--config') ? args[args.indexOf('--config') + 1] : 'search-loop.config.json';

const norm = (q) => String(q || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();

function latestDiscoveryDir(root) {
  const base = path.join(root, 'data', 'discovery');
  if (!fs.existsSync(base)) return null;
  const weeks = fs.readdirSync(base).filter((d) => /^\d{4}-W\d{2}$/.test(d)).sort();
  return weeks.length ? path.join(base, weeks[weeks.length - 1]) : null;
}

function measuredSeeds(dir, property, excludeWords, n) {
  if (!dir) return [];
  const file = path.join(dir, `${property}.json`);
  if (!fs.existsSync(file)) return [];
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const seen = new Set();
  return (doc.seeds || [])
    .filter((s) => s && s.query && Number(s.impressions) > 0)
    .sort((a, b) => Number(b.impressions) - Number(a.impressions) || String(a.query).localeCompare(String(b.query)))
    .map((s) => norm(s.query))
    .filter((q) => q.split(' ').length >= 2 && q.split(' ').length <= 7 && !excludeWords.some((w) => q.includes(norm(w))))
    .filter((q) => (seen.has(q) ? false : seen.add(q)))
    .slice(0, n);
}

function topicsFor(cfg, root = ROOT) {
  const v = cfg.velocity || {};
  const verticals = v.verticals || [];
  if (!verticals.length) throw new Error('search-loop.config.json has no velocity.verticals');
  const dir = latestDiscoveryDir(root);
  const exclude = (cfg.find && cfg.find.exclude_words) || [];
  const per = verticals.map((x) => [...(x.base_topics || []), ...measuredSeeds(dir, x.discovery_property, exclude, Number(v.max_discovery_seeds_per_vertical || 3))]);
  const out = [];
  const seen = new Set();
  for (let i = 0; per.some((list) => i < list.length); i += 1) {
    for (const list of per) {
      const t = list[i] && norm(list[i]);
      if (t && !seen.has(t)) { seen.add(t); out.push(t); }
    }
  }
  return { topics: out, discovery_week: dir ? path.basename(dir) : null };
}

module.exports = { topicsFor, measuredSeeds, latestDiscoveryDir };

if (require.main === module) {
  const file = path.join(ROOT, cfgRel);
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { topics, discovery_week } = topicsFor(cfg);
  const changed = JSON.stringify(topics) !== JSON.stringify(cfg.topics);
  if (args.includes('--check')) {
    console.log(`seed-topics: ${topics.length} topics, discovery week ${discovery_week || 'none'}, ${changed ? 'config is behind' : 'config current'}`);
    process.exit(0);
  }
  if (!discovery_week) console.log('NAMED NOTE [DISCOVERY_NOT_FOUND] no data/discovery/<week>/ yet; topics are the base topics only');
  if (changed) {
    cfg.topics = topics;
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
  }
  console.log(`seed-topics: ${topics.length} topics (${changed ? 'updated' : 'unchanged'}) from base topics + discovery week ${discovery_week || 'none'}`);
}
