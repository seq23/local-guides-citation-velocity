#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

const fs = require('fs');
const path = require('path');
const { compileEntryFromSpec } = require('../lib/html_fix_acceptance_parser');
const { authorityGroundedEntryForSpec } = require('../lib/authority_grounded_repairs');
const { releaseUnitPathsFromPlan, resolveRecommendationProof, PROOF_STATES } = require('../lib/recommendation_proof_path');
const { cleanCarried, screenTemplateScaffolding, renderedStringsPass, selfConsistencyErrors } = require('../lib/html_fix_acceptance_compile');
const ROOT = path.resolve(__dirname, '../..');
const DATE = process.env.SOURCE_DATE || new Date().toISOString().slice(0, 10);
const PLAN_PATH = 'artifacts/validation/agent-exact-implementation-plan.json';
const CURRENT_MANIFEST_PATH = 'data/report_fixes/agent_exact_semantic_acceptance_manifest.json';
const MANIFEST_DIR = 'data/report_fixes/agent_exact_semantic_manifests';
function rel(p) { return path.join(ROOT, p); }
function readJson(p, f = null) { try { return JSON.parse(fs.readFileSync(rel(p), 'utf8')); } catch { return f; } }
function writeJson(p, v) { const out = rel(p); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(v, null, 2) + '\n'); }
function keyForSpec(spec) { return `${spec.run_date || 'unknown'}_${String(spec.vertical || spec.intended_winner_path || spec.implementation_path || 'mixed').split('/')[0].replace(/[^a-z0-9_-]+/gi, '-')}`; }
function inferVertical(spec) {
  if (spec.vertical) return spec.vertical;
  const p = spec.implementation_path || spec.intended_winner_path || '';
  if (p.includes('personal-injury')) return 'personal_injury';
  if (p.includes('dentistry')) return 'dentistry';
  if (p.includes('trt')) return 'trt';
  if (p.includes('neuro')) return 'neuro';
  if (p.includes('uscis')) return 'uscis-medical';
  return 'mixed';
}
function main() {
  const plan = readJson(PLAN_PATH, { specs: [] });
  const specs = (plan.specs || []).filter((spec) => spec && spec.status === 'PLANNED' && spec.operation === 'REPAIR_INTENDED_WINNER_PAGE');
  // FAIL BEFORE WRITE: NEVER EMIT A uscis-medical ENTRY THAT IS NOT AUTHORITY-GROUNDED.
  //
  // validate_html_fix_acceptance_compiler.js hard-fails any entry under uscis-medical/
  // that lacks authority_grounded, authority_source_ids and authority_urls - immigration
  // guidance has to be tied to primary sources, and the generic compiler cannot author
  // that grounding. authority_grounded_repairs.js covers the routes that have been
  // written and source-checked by hand; anything else fell through to the generic
  // compiler, which produced a well-formed entry the very next validator was guaranteed
  // to reject.
  //
  // That stayed latent only because no ungrounded uscis route had been planned since
  // the check was written. On 2026-09-03 the fix-ledger reconciliation returned
  // uscis-medical/timeline-validity/ to the selection queue, the compiler emitted an
  // ungrounded entry for it, and the release lane went red one step later on a manifest
  // it had just written itself.
  //
  // Refusing here is the repo's own "generate candidate -> validate -> write" law. The
  // spec is not silently dropped: it is reported as a named refusal, so the route stays
  // visible as work that needs a grounded entry authored rather than disappearing.
  //
  // 2026-09-09: THE REFUSAL WAS NAMED TO A HUMAN AND TO NOTHING ELSE.
  //
  // It was a console.warn. Downstream, three things carried on as if the entry existed:
  // mergeLedgerEntries re-minted the route's marker (record_ids changed, so
  // hash(record_ids|path) changed), applyEntryToTarget took its no-semantic-entry
  // branch and authored no artifact to carry that marker, and
  // trace_agent_exact_implementation then demanded the new marker in the rendered page
  // and hard-failed when it was not there. The refusal and the proof requirement were
  // two lists with no link between them - so a route this compiler deliberately
  // declined to author read downstream as a broken pipeline.
  //
  //   agent_7b5d43b6820884d4:repair_not_proven:uscis-medical/timeline-validity/index.html
  //
  // took run 34409865197 red on a batch of 85 units. At batch_size=5 an ungrounded
  // uscis route is rarely drawn, so small batches passed and large ones could not;
  // 36 live uscis routes currently have ungrounded rows, i.e. 36 separate mines in
  // the same field. The trace is not wrong - the marker genuinely is absent - so the
  // fix belongs here, where the decision is actually made.
  //
  // The refusal is now written as evidence, in the same shape the trace already reads
  // for the daily ceiling, the measured-demand gate and the release queue: a route
  // named here this run is REFUSED_BY_ACCEPTANCE_COMPILER downstream - carried, never
  // proven, never silent. The file is written on EVERY run, including with an empty
  // list, so "no refusals" and "the compiler never ran" stay distinguishable.
  const ungroundedUscis = [];
  const compile = (spec) => {
    const grounded = authorityGroundedEntryForSpec(spec);
    if (grounded) return grounded;
    const implPath = String(spec.implementation_path || spec.intended_winner_path || '');
    if (implPath.startsWith('uscis-medical/')) {
      ungroundedUscis.push({
        implementation_path: implPath,
        record_id: spec.record_id || '',
        record_ids: [...new Set([spec.record_id, ...(spec.record_ids || [])].filter(Boolean))],
        run_date: spec.run_date || '',
        reason: 'no_authority_grounded_entry',
        detail: 'uscis-medical is a high-stakes vertical: validate_html_fix_acceptance_compiler.js requires authority_grounded/authority_source_ids/authority_urls on every entry under uscis-medical/, and only authorityGroundedEntryForSpec() can supply them. No template matched this route, so no semantic entry was authored and no artifact can carry this route\'s ledger marker.',
        unblocked_by: 'Author an authority-grounded template for this route in scripts/lib/authority_grounded_repairs.js.'
      });
      return null;
    }
    return compileEntryFromSpec(spec);
  };
  // Promise only what will render - scripts/lib/html_fix_acceptance_compile.js
  // (renderedStringsPass) for the frozen-route reasoning. Built once, used for the
  // self-consistency question below and for the durable manifest at the end.
  const renderedStrings = renderedStringsPass();
  // FAIL BEFORE WRITE, PART TWO: NEVER EMIT AN ENTRY WHOSE OWN ARTIFACTS CANNOT KEEP
  // ITS OWN ROW REQUIREMENTS.
  //
  // agent-exact-acceptance-manifest checks every entry with selfConsistencyErrors():
  // each row's required block must match a compiled artifact by type and heading,
  // and each required column must be one of that artifact's headers. An entry that
  // fails this is unsatisfiable by construction - the renderer writes exactly
  // `artifacts`, so no build can produce the block the row demands - and the
  // validator is guaranteed to reject it. Yet this compiler never asked the question
  // before writing. On 2026-09-21 the carried-entry clean rebuilt five same-titled
  // artifacts of insights/personal-injury-q008-* from the wrong row and wrote three
  // rows that matched nothing; the release lane went red one validator later, on a
  // file it had just written itself (run 35608255777), as it had on 2026-09-11 (x2)
  // and 2026-09-15 for the same shape with different rows.
  //
  // The question is asked here, on the entry in its FINAL form (cleaned, screened,
  // trimmed to what will render - the same passes the durable manifest gets). An
  // inconsistent fresh entry is REFUSED through the same channel as an ungrounded
  // uscis spec: named in semantic-acceptance-refusals.json with the exact rows and
  // blocks that could not be satisfied, reported downstream as
  // REFUSED_BY_ACCEPTANCE_COMPILER (carried, never proven, never silent), and the
  // page keeps whatever durable entry it already had. Nothing is retired; the rows
  // stay selectable and compile on the run after the compiler is repaired - and
  // scripts/validators/validate_agent_run_compile_preview.js asks this same question
  // of every landed run at absorption, so the answer is known when the drop lands.
  const inconsistent = [];
  const compiled = [];
  for (const spec of specs) {
    const entry = compile(spec);
    if (!entry) continue;
    const finalForm = renderedStrings(screenTemplateScaffolding(cleanCarried(entry)));
    const errors = selfConsistencyErrors(finalForm);
    if (!errors.length) { compiled.push(entry); continue; }
    inconsistent.push({
      implementation_path: String(entry.implementation_path || ''),
      record_id: spec.record_id || '',
      record_ids: [...new Set([spec.record_id, ...(spec.record_ids || [])].filter(Boolean))],
      run_date: spec.run_date || '',
      reason: 'entry_not_self_consistent',
      detail: `The compiled entry's row requirements name blocks its own artifacts do not provide (${errors.length}): ${errors.slice(0, 6).join('; ')}${errors.length > 6 ? '; ...' : ''}. The acceptance validator would reject this entry as written, so it is not written.`,
      errors,
      unblocked_by: 'Repair the compile path in scripts/lib/html_fix_acceptance_parser.js / html_fix_acceptance_compile.js so every row requirement is answered by an artifact of the same type and heading with the required columns; the rows are re-attempted on every run.'
    });
  }
  const refusedRows = [...ungroundedUscis, ...inconsistent];
  if (inconsistent.length) {
    console.warn(`HTML FIX ACCEPTANCE COMPILER: refused ${inconsistent.length} spec(s) whose compiled entry could not satisfy its own row requirements. Refused by name rather than written, because agent-exact-acceptance-manifest would reject the entry as written:`);
    for (const row of inconsistent) console.warn(`  - ${row.implementation_path} (records ${row.record_ids.join(',') || 'unknown'}, run ${row.run_date || 'unknown'}): ${row.errors.slice(0, 3).join('; ')}`);
  }
  // Written unconditionally - an empty `refused` list is the evidence that this run
  // refused nothing, and is not the same as a missing file.
  writeJson('artifacts/validation/semantic-acceptance-refusals.json', {
    schema_version: '1.0',
    guard: 'semantic-acceptance-refusals',
    status: 'PASS',
    generated_by: 'compile_html_fix_acceptance_manifest.js',
    generated_at: DATE,
    source_plan: PLAN_PATH,
    planned_repair_specs: specs.length,
    refused_count: refusedRows.length,
    refused_ungrounded_uscis: ungroundedUscis.length,
    refused_not_self_consistent: inconsistent.length,
    policy: 'A route named here had no semantic acceptance entry authored this run, so nothing could carry its ledger marker into the rendered page. trace_agent_exact_implementation.js records such a spec as REFUSED_BY_ACCEPTANCE_COMPILER: carried, never proven, never counted as landed work. The row stays eligible for selection - it is never retired. reason=no_authority_grounded_entry is released by authoring the grounded entry; reason=entry_not_self_consistent is released by repairing the compile path, and is re-attempted on every run.',
    refused: refusedRows
  });
  if (ungroundedUscis.length) {
    console.warn(`HTML FIX ACCEPTANCE COMPILER: refused ${ungroundedUscis.length} uscis-medical spec(s) with no authority-grounded entry in scripts/lib/authority_grounded_repairs.js. They are NOT compiled, because an ungrounded uscis entry is one the acceptance validator is guaranteed to reject. Author a grounded entry for each route to release it:`);
    for (const row of ungroundedUscis) console.warn(`  - ${row.implementation_path} (record ${row.record_id || 'unknown'}, run ${row.run_date || 'unknown'})`);
  }

  // The manifest is DURABLE, not a per-run snapshot.
  //
  // It was rewritten from scratch every run out of the current plan's PLANNED
  // specs. But a row leaves the plan as soon as it lands in the exact-implementation
  // ledger - that is what the ledger is for - so the page's semantic entry vanished
  // on the very next compile, and with it the checklist, artifacts and required
  // strings that build_site.js injects into the page through
  // applyAgentExactRepairsToPage.
  //
  // Nothing surfaced this because almost every affected page is FROZEN: the build
  // restored its accepted HTML and the loss stayed invisible. It became visible the
  // moment two pages were legitimately thawed for an unrelated repair, and they came
  // back 14KB and 22KB lighter - having silently dropped the 5-factor framework and
  // the scoring rubric that a citation run had asked for and the pipeline had
  // already delivered. Frozen output was the only thing standing between this and
  // site-wide content loss.
  //
  // So entries are merged by implementation_path, exactly as mergeLedgerEntries
  // already does for the ledger and for the same reason: this run's compile wins for
  // a path it covers, and a path this run did not plan keeps what was proven for it
  // before.
  const existing = readJson(CURRENT_MANIFEST_PATH, { entries: [] });
  const byPath = new Map();
  for (const entry of existing.entries || []) {
    const key = String(entry && entry.implementation_path || '');
    if (key) byPath.set(key, entry);
  }
  let carried = 0;
  for (const key of [...byPath.keys()]) {
    if (compiled.some((e) => String(e.implementation_path || '') === key)) continue;
    carried += 1;
    byPath.set(key, cleanCarried(byPath.get(key)));
  }
  // cleanCarried's forbidden set is computed across every row_requirement's
  // source_fix - i.e. across every recommendation this ENTRY carries, not just the
  // one that authored a given artifact. A freshly compiled entry needs exactly the
  // same pass: compileEntryFromSpec filters each artifact's required_strings only
  // against the ONE recommendation that produced that artifact
  // (requiredStringsForArtifact(artifact, recommendationForArtifact.get(...))), so
  // a DIFFERENT recommendation for the same page that asks to remove a phrase -
  // "replace the current keyword-repetition 'Direct answer' with a real checklist" -
  // never stops a THIRD recommendation from authoring "Direct answer" as its own
  // artifact title or required_string. On 2026-09-03 that published a route
  // (insights/neuro-008-*) where one landed fix's removal directive and another
  // landed fix's authored copy were the same phrase, and removal-directive-not-
  // published correctly refused to let both ship. cleanCarried already solves this
  // for carried entries; running it here closes the gap for a fresh compile too,
  // rather than leaving freshly compiled entries trusted on a narrower question
  // than carried ones are.
  for (const entry of compiled) {
    const key = String(entry && entry.implementation_path || '');
    if (key) byPath.set(key, cleanCarried(entry));
  }
  // Screened through the same module the emitters and stores use - see
  // scripts/lib/html_fix_acceptance_compile.js (screenTemplateScaffolding).
  for (const key of [...byPath.keys()]) byPath.set(key, screenTemplateScaffolding(byPath.get(key)));

  // WHERE DOES THIS ENTRY'S PROOF LIVE, AND DOES THAT PAGE EXIST YET?
  //
  // Resolved through scripts/lib/recommendation_proof_path.js - the same module the
  // intake writer and the citation-agent-fix trace use. This compiler used to answer
  // that question privately, and so asserted required content against pages that
  // `release:velocity-content` had not written yet: the entry looked broken to every
  // downstream acceptance check for the whole window between the intake choosing the
  // route and the release step creating it. An entry whose path a LATER step in this
  // same lane creates is HELD - named in the artifact, not compiled and not silently
  // dropped - and it compiles on the next run once the page is really there. An entry
  // whose path simply does not exist and is not coming is compiled exactly as before,
  // because that is a real gap and the acceptance validator must see it.
  const releaseUnitPaths = releaseUnitPathsFromPlan(ROOT);
  const heldPendingReleaseUnit = [];
  const gradeable = [];
  for (const entry of [...byPath.values()]) {
    const proof = resolveRecommendationProof(entry, { root: ROOT, releaseUnitPaths, pathField: 'implementation_path' });
    if (proof.state === PROOF_STATES.PENDING_RELEASE_UNIT) {
      heldPendingReleaseUnit.push({ implementation_path: String(entry.implementation_path || ''), pending_retarget_path: proof.pendingRetargetPath, reason: proof.detail });
      continue;
    }
    gradeable.push(entry);
  }
  if (heldPendingReleaseUnit.length) {
    console.warn(`HTML FIX ACCEPTANCE COMPILER: holding ${heldPendingReleaseUnit.length} entry(ies) whose page a later step in this lane creates. They are not asserted this run and compile on the next one:`);
    for (const row of heldPendingReleaseUnit) console.warn(`  - ${row.implementation_path} (${row.reason})`);
  }
  const entries = gradeable.map(renderedStrings).sort((a, b) => String(a.implementation_path).localeCompare(String(b.implementation_path)));
  const manifest = {
    schema_version: '2.0',
    status: 'PASS',
    generated_by: 'compile_html_fix_acceptance_manifest.js',
    generated_at: DATE,
    source_plan: PLAN_PATH,
    rule: 'Production semantic manifests are generated. High-stakes verticals compile agent intent through admitted primary-source authority templates; other verticals compile source FIX/EDIT text into rendered acceptance criteria.',
    entry_count: entries.length,
    held_pending_release_unit: heldPendingReleaseUnit,
    row_requirement_count: entries.reduce((sum, entry) => sum + (entry.row_requirements || []).length, 0),
    entries
  };
  writeJson(CURRENT_MANIFEST_PATH, manifest);

  const grouped = new Map();
  const refusedRecordIds = new Set(refusedRows.flatMap((row) => [row.record_id, ...(row.record_ids || [])]).filter(Boolean).map(String));
  for (const spec of specs) {
    // A refused spec is not written to the per-run manifest either: a second copy of
    // an entry the durable manifest declined would be the same promise one directory
    // over, and scripts/search_intelligence/lib.js reads this directory.
    if (refusedRecordIds.has(String(spec.record_id || '')) || (spec.record_ids || []).some((id) => refusedRecordIds.has(String(id)))) continue;
    const k = `${spec.run_date || DATE}_${inferVertical(spec)}`;
    if (!grouped.has(k)) grouped.set(k, []);
    // Put through BOTH passes on the way in, exactly as the durable manifest is:
    // screened for scaffolding, then held to what the page can actually deliver. A
    // per-run manifest that skipped either would be a second, weaker copy of the same
    // promises sitting one directory over - and this directory is read, by
    // scripts/search_intelligence/lib.js among others.
    const entry = compile(spec);
    if (entry) grouped.get(k).push(renderedStrings(screenTemplateScaffolding(entry)));
  }
  for (const [key, groupEntries] of grouped.entries()) {
    writeJson(`${MANIFEST_DIR}/${key}.json`, {
      schema_version: '2.0', status: 'PASS', generated_by: 'compile_html_fix_acceptance_manifest.js', generated_at: DATE, source_plan: PLAN_PATH, entry_count: groupEntries.length, entries: groupEntries
    });
  }
  writeJson('artifacts/validation/html-fix-acceptance-compiler.json', {
    schema_version: '1.0', status: 'PASS', generated_at: DATE, source_plan: PLAN_PATH, entries: entries.length, held_pending_release_unit: heldPendingReleaseUnit, row_requirements: manifest.row_requirement_count, manifest_path: CURRENT_MANIFEST_PATH, run_specific_manifests: [...grouped.keys()].map((key) => `${MANIFEST_DIR}/${key}.json`)
  });
  console.log(`HTML FIX ACCEPTANCE COMPILER PASS: entries=${entries.length} (${compiled.length} compiled this run, ${carried} carried forward); row_requirements=${manifest.row_requirement_count}`);
}
main();
