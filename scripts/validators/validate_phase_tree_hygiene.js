#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { validateShardedDataset, iterateShardedRecords } = require('../lib/sharded_json');

const ROOT = path.resolve(__dirname, '../..');

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function writeReport(report) {
  const out = path.join(ROOT, 'artifacts/validation/local-guides-tree-hygiene.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}

function runGit(args) {
  const result = cp.spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.status !== 0) return null;
  return (result.stdout || '').split(/\r?\n/).filter(Boolean);
}

function walk(dir, out = [], options = {}) {
  const skipDirs = new Set(options.skipDirs || []);
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    if (['.git'].includes(ent.name)) continue;
    if (ent.isDirectory() && skipDirs.has(rel)) continue;
    if (ent.isDirectory()) {
      out.push({ rel, type: 'dir' });
      walk(abs, out, options);
    } else {
      out.push({ rel, type: 'file' });
    }
  }
  return out;
}

function rawNodeModulesEntries() {
  return fs.existsSync(path.join(ROOT, 'node_modules'))
    ? [{ rel: 'node_modules', type: 'dir' }]
    : [];
}

function nodeModulesSourceEntries() {
  const rawEntries = rawNodeModulesEntries();
  if (!fs.existsSync(path.join(ROOT, '.git'))) {
    return {
      mode: 'runtime-workspace-no-git',
      entries: [],
      raw_entries: rawEntries.length,
      git_tracked_entries: 0,
      git_visible_untracked_entries: 0
    };
  }

  const tracked = runGit(['ls-files', '-z', '--', 'node_modules']);
  const visibleUntracked = runGit(['ls-files', '-z', '--others', '--exclude-standard', '--', 'node_modules']);
  const parseNul = (lines) => {
    if (!lines) return null;
    return lines.flatMap((line) => line.split('\0')).filter(Boolean);
  };
  const trackedEntries = parseNul(tracked);
  const visibleUntrackedEntries = parseNul(visibleUntracked);

  if (!trackedEntries || !visibleUntrackedEntries) {
    return {
      mode: 'git-unavailable-raw-fallback',
      entries: rawEntries,
      raw_entries: rawEntries.length,
      git_tracked_entries: null,
      git_visible_untracked_entries: null
    };
  }

  return {
    mode: 'git-source-membership',
    entries: trackedEntries.map((rel) => ({ rel, type: 'git-tracked-source' })),
    raw_entries: rawEntries.length,
    git_tracked_entries: trackedEntries.length,
    git_visible_untracked_entries: visibleUntrackedEntries.length
  };
}

const errors = [];
const warnings = [];
const all = walk(ROOT, [], { skipDirs: ['node_modules'] });
const rootFiles = all.filter((x) => x.type === 'file' && !x.rel.includes('/')).map((x) => x.rel).sort();
const rootHtml = rootFiles.filter((x) => x.endsWith('.html'));
const generatedRootFiles = rootFiles.filter((x) => /100k|fanout|citation.*runway|scoreboard|free.?win|self.?heal|zero.?dollar/i.test(x));
const nodeModulesSource = nodeModulesSourceEntries();

for (const rel of [
  'data/strategy/citation_growth_strategy.json',
  'data/queries/citation_fanout_opportunities_100k/index.json',
  'data/measurement/citation_honesty_scoreboard.json',
  'data/measurement/zero_dollar_citation_test_ledger.json',
  'data/measurement/free_win_self_heal_queue.json',
  'artifacts/validation/citation-100k-runway.json',
  'scripts/citation_intelligence/build_100k_citation_runway.js'
]) {
  if (!exists(rel)) errors.push(`missing_expected_phase_file:${rel}`);
}

for (const rel of [
  'reports/citation-100k-runway.md'
]) {
  if (!exists(rel)) warnings.push(`missing_generated_report_warning:${rel}`);
}

if (rootHtml.length > 8) errors.push(`root_html_pollution:${rootHtml.length}`);
if (generatedRootFiles.length) errors.push(`generated_phase_files_in_repo_root:${generatedRootFiles.join(',')}`);
if (nodeModulesSource.entries.length) errors.push('node_modules_present_in_source_snapshot');

let fanoutValidation = { ok:false, errors:['fanout_index_missing'], record_count:0, shard_count:0 };
if (exists('data/queries/citation_fanout_opportunities_100k/index.json')) {
  try {
    fanoutValidation = validateShardedDataset('data/queries/citation_fanout_opportunities_100k', 100000);
    const seenQueries = new Set();
    const seenRoutes = new Set();
    let duplicateQueries = 0;
    let duplicateRoutes = 0;
    for (const record of iterateShardedRecords('data/queries/citation_fanout_opportunities_100k')) {
      const queryKey = String(record.query || '').trim().toLowerCase();
      const routeKey = String(record.route_candidate || '').trim().toLowerCase();
      if (queryKey) {
        if (seenQueries.has(queryKey)) duplicateQueries += 1;
        else seenQueries.add(queryKey);
      }
      if (routeKey) {
        if (seenRoutes.has(routeKey)) duplicateRoutes += 1;
        else seenRoutes.add(routeKey);
      }
    }
    if (duplicateQueries) fanoutValidation.errors.push(`exact_duplicate_queries:${duplicateQueries}`);
    if (duplicateRoutes) fanoutValidation.errors.push(`exact_duplicate_route_candidates:${duplicateRoutes}`);
    fanoutValidation.ok = fanoutValidation.errors.length === 0;
    fanoutValidation.unique_query_count = seenQueries.size;
    fanoutValidation.unique_route_candidate_count = seenRoutes.size;
  }
  catch (err) { fanoutValidation = { ok:false, errors:[`fanout_validation_error:${err.message}`], record_count:0, shard_count:0 }; }
}
if (!fanoutValidation.ok) errors.push(...fanoutValidation.errors.map((e)=>`fanout_shard_integrity:${e}`));
if (exists('data/queries/citation_fanout_opportunities_100k.json')) errors.push('legacy_fanout_monolith_reintroduced');
const fanoutDir = path.join(ROOT, 'data/queries/citation_fanout_opportunities_100k');
if (fs.existsSync(fanoutDir)) {
  const plainShards = fs.readdirSync(fanoutDir).filter((name) => /^part-\d+\.json$/.test(name));
  if (plainShards.length) errors.push(`uncompressed_fanout_shards_reintroduced:${plainShards.join(',')}`);
}

const report = {
  validator: 'local-guides-tree-hygiene',
  ok: errors.length === 0,
  generated_at: new Date().toISOString(),
  root_files: rootFiles.length,
  root_html: rootHtml.length,
  root_html_files: rootHtml,
  generated_root_files: generatedRootFiles,
  node_modules_detection_mode: nodeModulesSource.mode,
  node_modules_entries: nodeModulesSource.entries.length,
  node_modules_raw_entries: nodeModulesSource.raw_entries,
  node_modules_git_tracked_entries: nodeModulesSource.git_tracked_entries,
  node_modules_git_visible_untracked_entries: nodeModulesSource.git_visible_untracked_entries,
  fanout_records: fanoutValidation.record_count,
  fanout_shards: fanoutValidation.shard_count,
  fanout_aggregate_sha256: fanoutValidation.aggregate_sha256 || null,
  expected_locations: {
    strategy: 'data/strategy/',
    fanout_queries: 'data/queries/citation_fanout_opportunities_100k/',
    measurement_ledgers: 'data/measurement/',
    validation_receipts: 'artifacts/validation/',
    reports: 'reports/',
    scripts: 'scripts/citation_intelligence/'
  },
  warnings,
  errors
};

writeReport(report);
if (warnings.length) console.warn(warnings.join('\n'));
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('local-guides-tree-hygiene PASS');
