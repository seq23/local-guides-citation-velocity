#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
/**
 * A ledgered repair marker must survive the accepted-artifact store.
 *
 * mergeAcceptedArtifacts() refreshes an accepted page's blocks from the current
 * build, keyed on `type|title`, and keeps the ACCEPTED copy whenever the current
 * one is lighter - the shrink this store exists to prevent. That rule is right
 * for rebuild drift and wrong for a repair.
 *
 * An agent-exact repair marker is minted per repair as
 * hash(record_ids | implementation_path) and stamped onto the FIRST semantic
 * artifact (scripts/lib/agent_exact_repairs.js artifactsWithMarker). Which block
 * carries it is therefore decided by the semantic manifest, not by size. On
 * /personal-injury/ it landed on `cost_table|"Direct answer,"` - a key the
 * accepted store holds three copies of - and the freshly authored 939-byte block
 * was paired with the 1066-byte accepted one, lost the weight comparison, and was
 * consumed: dropped entirely rather than appended. The page kept the previous
 * run's marker, and agent-exact-implementation-trace correctly reported
 * agent_db794554f0377d3c:repair_not_proven:personal-injury/index.html. That took
 * Velocity Content Release red on run 34197241611, four minutes after the same
 * validator had passed on the same tree.
 *
 * The failure is invisible from the outside: the store records nothing when it
 * discards a block, so the only trace was a count (record_ids_unproven: 97) that
 * names no route. Nothing could have told you WHICH repair had been swallowed.
 *
 * This validator pins the resulting contract on the merge function directly,
 * which is where the decision is made:
 *
 *   1. A current block carrying a marker the accepted copy does not carry MUST
 *      survive, even when it is lighter. Otherwise a repair can never land on an
 *      accepted page and the trace hard-fails the release lane.
 *   2. A current block with NO fresh marker MUST still lose to a heavier accepted
 *      copy. The shrink guard has to stay intact for ordinary rebuild drift -
 *      this is what stops the fix above from being applied too widely.
 *   3. Nothing is ever silently dropped: every accepted block and every current
 *      block must be represented in the output.
 *
 * Cases 1 and 2 are opposite directions of the same comparison, so a change that
 * satisfies one by abandoning the other cannot pass.
 *
 * Rule 0 / Rule 4: a case table that examined zero cases is a FAILURE.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const OUT_REL = 'artifacts/validation/repair-marker-survives-acceptance.json';
const STORE_REL = 'data/release/accepted_page_artifacts.json';
const FIXTURE_ROUTE = 'fixture-route/index.html';

// The merge function reads the accepted store from a fixed path relative to its
// OWN location, so the fixture gets a scratch copy of scripts/ with a synthetic
// store beside it. The real data/release/accepted_page_artifacts.json - the
// record of what this site has actually delivered - is never opened for writing.
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-marker-'));
fs.mkdirSync(path.join(SCRATCH, 'scripts/lib'), { recursive: true });
fs.mkdirSync(path.join(SCRATCH, 'data/release'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'scripts/lib'))) {
  const src = path.join(ROOT, 'scripts/lib', f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(SCRATCH, 'scripts/lib', f));
}
const SCRATCH_MODULE = path.join(SCRATCH, 'scripts/lib/accepted_artifacts.js');
const SCRATCH_STORE = path.join(SCRATCH, STORE_REL);

const errors = [];
const cases = [];

function block(title, body, marker) {
  const artifact = { type: 'cost_table', title, rows: [body] };
  if (marker) { artifact.marker = marker; artifact.id = marker; }
  return artifact;
}

function serialized(list) { return JSON.stringify(list); }

/**
 * Drive mergeAcceptedArtifacts in the scratch tree against a synthetic accepted
 * store. Loaded fresh each time so the module's internal store cache cannot
 * carry a previous case's fixture into the next one.
 */
function withAcceptedStore(acceptedArtifacts, fn) {
  fs.writeFileSync(SCRATCH_STORE, JSON.stringify({ routes: { [FIXTURE_ROUTE]: { artifacts: acceptedArtifacts } } }), 'utf8');
  delete require.cache[require.resolve(SCRATCH_MODULE)];
  const mod = require(SCRATCH_MODULE);
  mod.resetCache();
  // Rule 4, applied per case. mergeAcceptedArtifacts SHORT-CIRCUITS when a route
  // has no accepted artifacts - it returns the current list untouched. Every
  // assertion below would then hold vacuously, and this validator would report
  // PASS having exercised none of the merge logic it exists to pin down. Refuse
  // unless the store really did hand back the fixture.
  const seen = mod.acceptedArtifactsFor(FIXTURE_ROUTE);
  if (seen.length !== acceptedArtifacts.length) {
    console.error(`REPAIR MARKER SURVIVES ACCEPTANCE FAIL: the fixture store returned ${seen.length} accepted artifact(s) for ${FIXTURE_ROUTE}, expected ${acceptedArtifacts.length}. With no accepted artifacts mergeAcceptedArtifacts returns the current list unchanged and every case below passes without exercising the merge at all.`);
    process.exit(1);
  }
  return fn(mod.mergeAcceptedArtifacts);
}

function record(name, ok, detail) {
  cases.push({ case: name, status: ok ? 'PASS' : 'FAIL', detail });
  if (!ok) errors.push(`${name}: ${detail}`);
}

function main() {
  const heavy = 'x'.repeat(400);
  const light = 'y'.repeat(40);

  // 1. A lighter block carrying a FRESH marker must survive.
  withAcceptedStore([block('Direct answer,', heavy, 'agent-exact-oldmarker')], (merge) => {
    const merged = merge(FIXTURE_ROUTE, [block('Direct answer,', light, 'agent-exact-newmarker')]);
    const text = serialized(merged);
    record(
      'fresh_marker_survives_a_heavier_accepted_block',
      text.includes('agent-exact-newmarker'),
      text.includes('agent-exact-newmarker')
        ? 'the repair block replaced the heavier accepted copy'
        : 'a lighter block carrying a NEW ledger marker was discarded in favour of the heavier accepted copy. The repair can never reach the page, so agent-exact-implementation-trace will report repair_not_proven and hard-fail the release lane.',
    );
  });

  // 2. A lighter block with NO fresh marker must still lose. The shrink guard
  //    must not have been traded away to satisfy case 1.
  withAcceptedStore([block('Direct answer,', heavy, null)], (merge) => {
    const merged = merge(FIXTURE_ROUTE, [block('Direct answer,', light, null)]);
    const text = serialized(merged);
    record(
      'unmarked_shrink_still_loses_to_the_accepted_copy',
      text.includes(heavy) && !text.includes(light),
      text.includes(heavy) && !text.includes(light)
        ? 'the heavier accepted copy stood, as the shrink guard requires'
        : 'a lighter block with no ledger marker replaced the heavier accepted copy. That is the silent content shrink this store exists to prevent - the repair exception has been applied too widely.',
    );
  });

  // 3. A block carrying the SAME marker as the accepted copy is not a repair,
  //    so it must obey the weight rule too.
  withAcceptedStore([block('Direct answer,', heavy, 'agent-exact-samemarker')], (merge) => {
    const merged = merge(FIXTURE_ROUTE, [block('Direct answer,', light, 'agent-exact-samemarker')]);
    const text = serialized(merged);
    record(
      'unchanged_marker_does_not_buy_a_shrink',
      text.includes(heavy),
      text.includes(heavy)
        ? 'an unchanged marker did not exempt a lighter block'
        : 'a lighter block carrying the marker the accepted copy ALREADY had replaced it. Re-emitting the same marker is not a repair and must not bypass the shrink guard.',
    );
  });

  // 4. Nothing is silently dropped.
  withAcceptedStore([block('Direct answer,', heavy, null), block('Other table', heavy, null)], (merge) => {
    const merged = merge(FIXTURE_ROUTE, [block('Direct answer,', light, 'agent-exact-newmarker'), block('Brand new block', light, null)]);
    const titles = new Set(merged.map((a) => a && a.title));
    const ok = titles.has('Direct answer,') && titles.has('Other table') && titles.has('Brand new block');
    record(
      'no_block_is_silently_dropped',
      ok,
      ok ? 'every accepted block and every current block is represented'
        : `merged output lost a block: ${JSON.stringify([...titles])}. The store must never discard content without it appearing somewhere.`,
    );
  });

  // Rule 0 / Rule 4: an empty case table proves nothing.
  if (!cases.length) {
    console.error('REPAIR MARKER SURVIVES ACCEPTANCE FAIL: the case table is empty, so this validator examined zero merges and proved nothing about the accepted-artifact store.');
    process.exit(1);
  }

  const report = {
    schema_version: '1.0',
    validator: 'repair-marker-survives-acceptance',
    status: errors.length ? 'FAIL' : 'PASS',
    cases_examined: cases.length,
    cases,
    errors,
  };
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, path.dirname(OUT_REL)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT_REL), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (errors.length) {
    console.error('REPAIR MARKER SURVIVES ACCEPTANCE FAIL');
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`REPAIR MARKER SURVIVES ACCEPTANCE: FAIL - ${errors.length} of ${cases.length} case(s) failed.`);
    process.exit(1);
  }
  console.log(`REPAIR MARKER SURVIVES ACCEPTANCE PASS: ${cases.length} case(s) examined against mergeAcceptedArtifacts - a fresh ledger marker survives a heavier accepted block, an unmarked shrink still loses, an unchanged marker buys no shrink, and no block is silently dropped.`);
}

if (require.main === module) main();
