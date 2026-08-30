#!/usr/bin/env node
'use strict';
/**
 * Two lanes, one file, two ideas of "now" - and the guard for both halves of the
 * 2026-08-30 query-evidence-refresh failure.
 *
 * content/_live/published_urls.json is stamped by scripts/lib/publish_contract.js.
 * Its stamp came from stableGeneratedAt(), which answers from SOURCE_DATE when a
 * lane sets one and from the newest date in data/citation_velocity/runs.json when
 * none does. velocity-content-release.yml sets it; query-evidence-refresh.yml does
 * not. So a release stamped the inventory 2026-08-29 and the next evidence refresh
 * rebuilt the identical inventory and stamped it 2026-06-23. That path is outside
 * the evidence lane's commit surface - correctly, it is publish state - so the lane
 * refused to commit a tree it had not validated and went red, daily, over a file
 * whose contents nobody had changed.
 *
 * The same run also stopped on feeds/promotion-candidates.json, which is the
 * opposite defect: a projection of the very evidence this lane refreshes, written
 * by a validator's declared `npm run build` prepare step, that the lane's surface
 * did not cover. The lane could not commit the thing it exists to produce.
 *
 * This asserts both, behaviourally, without a full build:
 *
 *   A. Rebuilding an unchanged inventory does not move its stamp, whatever
 *      SOURCE_DATE says; the stamp never travels backwards; and it still advances
 *      when the inventory really changes, so the fix is a rule and not a freeze.
 *   B. Every write an ACTIVE validator declares - repair or prepare - is inside the
 *      lane's commit surface.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const contract = require(path.join(ROOT, 'scripts/selfheal/lane_commit_contract.js'));
const publish = require(path.join(ROOT, 'scripts/lib/publish_contract.js'));

const { PUBLISHED_URLS_PATH, ensurePublishedUrlInventory } = publish;
const errors = [];
const checks = [];
const fail = (message) => { errors.push(message); };

const before = fs.readFileSync(PUBLISHED_URLS_PATH, 'utf8');
let restored = false;
const restore = () => { if (restored) return; restored = true; fs.writeFileSync(PUBLISHED_URLS_PATH, before); };
process.on('exit', restore);

const original = JSON.parse(before);
const items = Array.isArray(original.items) ? original.items : [];

// Zero-item rule: an empty inventory would make every stability assertion below
// true by vacancy.
if (items.length === 0) {
  console.error('PUBLISHED INVENTORY STABILITY FAIL: content/_live/published_urls.json holds zero items; there is no inventory to prove anything about.');
  process.exit(1);
}

const withSourceDate = (value, fn) => {
  const priorSource = process.env.SOURCE_DATE;
  const priorRelease = process.env.RELEASE_DATE;
  if (value === null) { delete process.env.SOURCE_DATE; delete process.env.RELEASE_DATE; }
  else { process.env.SOURCE_DATE = value; delete process.env.RELEASE_DATE; }
  try { return fn(); } finally {
    if (priorSource === undefined) delete process.env.SOURCE_DATE; else process.env.SOURCE_DATE = priorSource;
    if (priorRelease === undefined) delete process.env.RELEASE_DATE; else process.env.RELEASE_DATE = priorRelease;
  }
};
const rewrite = (sourceDate, entries) => withSourceDate(sourceDate, () => ensurePublishedUrlInventory(entries.map((item) => ({ ...item }))));

// A1. The lane that sets no SOURCE_DATE must leave an unchanged inventory alone.
rewrite(null, items);
if (fs.readFileSync(PUBLISHED_URLS_PATH, 'utf8') !== before) {
  const now = JSON.parse(fs.readFileSync(PUBLISHED_URLS_PATH, 'utf8'));
  fail(`rebuilding the unchanged inventory with no SOURCE_DATE moved it (${original.generated_at} -> ${now.generated_at}); the evidence lane will hard-stop on a file nobody changed`);
} else {
  checks.push('unchanged inventory, no SOURCE_DATE -> byte-identical');
}
restore(); restored = false;

// A2. A stamp on a published surface must never travel backwards.
rewrite('2020-01-01', items);
const afterOld = JSON.parse(fs.readFileSync(PUBLISHED_URLS_PATH, 'utf8'));
if (afterOld.generated_at !== original.generated_at) {
  fail(`an older SOURCE_DATE regressed the published stamp (${original.generated_at} -> ${afterOld.generated_at})`);
} else {
  checks.push('older SOURCE_DATE -> stamp held at ' + original.generated_at);
}
restore(); restored = false;

// A3. And it must still advance on a real change, or this is a freeze, not a rule.
const changed = [...items.slice(1), { ...items[0], url: `${items[0].url}#published-inventory-stability-probe` }];
rewrite('2099-01-01', changed);
const afterChange = JSON.parse(fs.readFileSync(PUBLISHED_URLS_PATH, 'utf8'));
if (afterChange.generated_at !== '2099-01-01T00:00:00.000Z') {
  fail(`a genuinely changed inventory did not take the newer stamp (got ${afterChange.generated_at}); the rule has become a freeze`);
} else {
  checks.push('changed inventory, newer SOURCE_DATE -> stamp advanced');
}
restore();

// B. Everything a validator declares it writes must be committable by the lane -
// unless git ignores it, in which case it is a build output that never reaches a
// commit and never shows up in the lane's `git status` either.
const cp = require('child_process');
const patterns = contract.committablePatterns(ROOT);
const isIgnored = (paths) => {
  const literals = paths.filter((p) => !p.includes('*'));
  if (!literals.length) return new Set();
  const probe = cp.spawnSync('git', ['check-ignore', '--stdin'], { cwd: ROOT, input: `${literals.join('\n')}\n`, encoding: 'utf8' });
  if (probe.status !== 0 && probe.status !== 1) {
    fail(`git check-ignore could not answer (status ${probe.status}); refusing to assume anything about the commit surface`);
    return null;
  }
  return new Set((probe.stdout || '').split('\n').map((line) => line.trim()).filter(Boolean));
};
const registry = JSON.parse(fs.readFileSync(path.join(ROOT, '_validation_registry.json'), 'utf8'));
const declared = [];
const allDeclared = [];
for (const validator of registry.validators || []) {
  if (validator.status !== 'ACTIVE') continue;
  const writes = [
    ...(validator.repair_command ? (validator.repair_writes || []) : []),
    ...((validator.prepare_commands || []).length
      ? [...(validator.prepare_produces_files || []), ...(validator.prepare_mutates_files || [])]
      : []),
  ];
  for (const write of writes) allDeclared.push({ id: validator.id, write });
}
const ignoredWrites = isIgnored(allDeclared.map((d) => d.write)) || new Set();
for (const { id, write } of allDeclared) {
  if (ignoredWrites.has(write)) continue;
  declared.push({ id, write });
  if (!contract.isCommittable(write, patterns)) {
    fail(`${id} declares it writes ${write}, which is outside the evidence lane's commit surface; that lane will hard-stop the moment this write happens`);
  }
}
// C. And nothing in that surface may be a path git refuses to add: the commit
// step hands these straight to `git add`, and an ignored path is a hard error
// there. dist/feeds/promotion-candidates.json is declared by a validator's
// prepare step and dist/ is in .gitignore, which turned a correct surface into
// a failing commit.
const surfaceLiterals = patterns.filter((p) => !p.includes('*'));
if (surfaceLiterals.length === 0) {
  fail('the lane commit surface contains no literal paths to test against .gitignore; this check has stopped reaching what it governs');
} else {
  const ignoredSurface = isIgnored(surfaceLiterals);
  if (ignoredSurface && ignoredSurface.size) {
    fail(`the lane commit surface contains git-ignored path(s) that \`git add\` will reject: ${[...ignoredSurface].join(', ')}`);
  } else if (ignoredSurface) {
    checks.push(`${surfaceLiterals.length} literal surface path(s), none git-ignored`);
  }
}

// Zero-item rule again: a scan of nothing proves nothing.
if (declared.length === 0) {
  fail('no ACTIVE validator declares a repair or prepare write; either the registry keys were renamed or this check no longer reaches the code it governs');
} else {
  checks.push(`${declared.length} declared validator write(s) all inside the lane surface`);
}

const report = {
  schema_version: '1.0',
  validator: 'published-inventory-stability',
  status: errors.length ? 'FAIL' : 'PASS',
  inventory_items: items.length,
  inventory_generated_at: original.generated_at,
  declared_writes_checked: declared.length,
  declared_writes_ignored_by_git: allDeclared.length - declared.length,
  committable_patterns: patterns,
  checks,
  errors,
  checked_at: new Date().toISOString(),
};
fs.mkdirSync(path.join(ROOT, 'artifacts/validation'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'artifacts/validation/published-inventory-stability.json'), `${JSON.stringify(report, null, 2)}\n`);

if (errors.length) {
  console.error(`PUBLISHED INVENTORY STABILITY FAIL: ${errors.length} problem(s)`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}
console.log(`PUBLISHED INVENTORY STABILITY PASS: ${items.length} inventory items, ${declared.length} declared validator writes; ${checks.join('; ')}`);
