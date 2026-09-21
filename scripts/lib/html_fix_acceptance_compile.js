'use strict';
/**
 * THE DURABLE-ENTRY PIPELINE, IN ONE PLACE.
 *
 * compile_html_fix_acceptance_manifest.js used to hold these three passes as
 * closures inside main(): the carried-entry clean, the template-scaffolding screen
 * and the "promise only what will render" trim. That made them unreachable from
 * anywhere else - in particular from the placement step, which absorbs a landed
 * agent run and pushes it to main WITHOUT ever compiling it. Every defect in these
 * passes therefore surfaced one job later, in the release step, as a red lane on
 * a manifest the lane had just written itself (2026-09-11 x2, 09-15, 09-21).
 *
 * They live here so that the compiler and
 * scripts/validators/validate_agent_run_compile_preview.js run the SAME code on
 * the same rows: the preview asks at absorption "would this run compile into a
 * manifest its own validator accepts?", and the compiler refuses by name any entry
 * for which the answer is no (selfConsistencyErrors, in html_fix_rendering_contract).
 */
const { compileEntryFromSpec, artifactFromFix, phrasesTheFixAsksToRemove, normalizeForbidden } = require('./html_fix_acceptance_parser');
const { mergeAcceptedArtifacts } = require('./accepted_artifacts');
const { stripTemplateScaffoldingFromArtifacts, withoutTemplateScaffolding } = require('./template_scaffolding');
const { countRowsNearHeading, includesNormalized, selfConsistencyErrors } = require('./html_fix_rendering_contract');
const { acceptedHtmlForRoute, normalizeRoute, mutableRouteSet } = require('./frozen_pages');

// A carried entry was compiled before requiredStringsForArtifact learned to refuse
// a phrase its own fix asked to delete, so it can still be asserting one. The
// recommendation that proves it is stored on the entry as row_requirements[].source_fix,
// so the same filter is re-applied here rather than trusting an old compile.
//
// 2026-09-01: dropping it from the required_strings was only half the repair. The
// same quoted span had also been chosen as the artifact TITLE, which renders as the
// visible <h2> and is copied into required_blocks[].heading_exact - so
// /dentistry/choosing-a-dentist/ went on publishing a heading reading "Use the same
// questions with every lawyer on your shortlist" while asserting nothing about it.
// A carried artifact whose title is a phrase its own fix asked to delete is now
// RECOMPILED from that same source_fix through the repaired parser, rather than
// merely un-asserted, and its row's heading_exact is re-pointed at the new title.
//
// 2026-09-21: RECOMPILED FROM ITS OWN ROW, NOT FROM THE FIRST ROW THAT SHARES ITS
// TITLE. The rebuild found "the row for this artifact" by heading alone. When five
// rows of one page all carried the heading "Mistakes that can increase a fault
// dispute" (a protocol, a callout, a comparison_table and two agent_directives), a
// sixth row's dedupe request put that phrase in the forbidden set, and all five
// artifacts were rebuilt from row ONE - so five agent_directives came back, three
// rows' required blocks (protocol / callout / comparison_table under that heading)
// matched nothing, and the manifest the compiler had just written failed
// agent-exact-acceptance-manifest with compiled_artifact_missing x3 and
// missing_column "Why it matters". The artifact now records the row it was compiled
// for (record_id), the rebuild goes through that row, and only that row's block is
// re-pointed. And the rebuild is handed the ENTRY-WIDE forbidden set, so it cannot
// come back titled with the very phrase that got it rebuilt.
function cleanCarried(entry) {
  const forbidden = new Set();
  for (const row of entry.row_requirements || []) {
    for (const phrase of phrasesTheFixAsksToRemove(row.source_fix || '')) forbidden.add(phrase);
  }
  if (!forbidden.size) return entry;
  const isForbidden = (value) => forbidden.has(normalizeForbidden(value));
  const drop = (list) => (list || []).filter((value) => !isForbidden(value));
  const rows = entry.row_requirements || [];
  const rowFor = (artifact) => {
    if (artifact.record_id) {
      const own = rows.find((row) => String(row.row_id) === String(artifact.record_id));
      if (own) return own;
    }
    // Entries compiled before artifacts carried record_id: match type AND heading,
    // then heading alone as the last resort the old code used.
    return rows.find((row) => (row.required_blocks || []).some((block) => block && block.heading_exact === artifact.title && block.type === artifact.type))
      || rows.find((row) => (row.required_blocks || []).some((block) => block && block.heading_exact === artifact.title));
  };
  // row_id -> { from, to, type } for the one row each rebuilt artifact belongs to.
  const retitledByRow = new Map();
  const artifacts = (entry.artifacts || []).map((artifact) => {
    if (!artifact || !isForbidden(artifact.title)) return artifact;
    const row = rowFor(artifact);
    if (!row) return null; // Nothing to recompile from: refuse to publish it at all.
    const rebuilt = artifactFromFix({ recommendation: row.source_fix, query: row.query, recordId: row.row_id, index: 0, alsoForbidden: forbidden });
    retitledByRow.set(String(row.row_id), { from: artifact.title, to: rebuilt.title, type: rebuilt.type });
    return { ...rebuilt, id: artifact.id, marker: artifact.marker };
  }).filter(Boolean);
  const firstRetitle = [...retitledByRow.values()][0];
  return {
    ...entry,
    title: isForbidden(entry.title) ? ((firstRetitle && firstRetitle.to) || artifacts[0]?.title || entry.title) : entry.title,
    artifacts,
    required_strings: drop(entry.required_strings),
    checklist: drop(entry.checklist),
    row_requirements: rows.map((row) => {
      const retitle = retitledByRow.get(String(row.row_id));
      return {
        ...row,
        required_blocks: (row.required_blocks || []).map((block) => (block && retitle && block.heading_exact === retitle.from
          ? { ...block, heading_exact: retitle.to, type: retitle.type, heading_source: 'derived' }
          : block)),
        required_strings: drop(row.required_strings)
      };
    })
  };
}

// THE MANIFEST IS PART OF THE PAGE, SO IT GETS THE SAME SCREEN THE PAGE GETS.
//
// scripts/lib/template_scaffolding.js stopped the emitters padding a table up to a
// requested row count with `Concrete verification point <n>` / `Requirement <n>`,
// and screens the two durable artifact stores on load. This compiler was never
// told. So the manifest went on ASSERTING the padding as required_strings, and went
// on carrying min_rows counts that only added up while the padded rows existed - and
// the rendering contract dutifully reported the pages as broken:
//
//   dentistry/anxiety-trust/index.html:missing_required_string:Concrete verification point 3
//   dentistry/choosing-a-dentist/index.html:row:agent_62c166acdc8b1f94:min_rows_not_met:1<3
//
// Two components, each keeping its own idea of what a page contains, with no link
// between them - which is why this screens through the SAME module the emitters and
// the stores use rather than restating the patterns here. There is no fourth copy of
// the list.
//
// The entry's own `artifacts` are screened too, not just its strings: the block
// below derives what "will actually render" from mergeAcceptedArtifacts(path,
// entry.artifacts), and an unscreened carried artifact put the padded rows straight
// back into that answer - which is exactly how a string like "Concrete verification
// point 3" survived a filter whose whole job was to drop strings the page does not
// publish.
//
// OMIT, NEVER PAD: the padded rows are not restored to make the count add up. The
// count falls to the rows that genuinely survive.
function screenTemplateScaffolding(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return {
    ...entry,
    artifacts: stripTemplateScaffoldingFromArtifacts(entry.artifacts || []),
    required_strings: withoutTemplateScaffolding(entry.required_strings),
    checklist: withoutTemplateScaffolding(entry.checklist),
    row_requirements: (entry.row_requirements || []).map((row) => ({
      ...row,
      required_strings: withoutTemplateScaffolding(row.required_strings)
    }))
  };
}

// A CARRIED entry's promises are re-tested against what will actually render.
//
// Carrying an entry forward carried its required_strings with it, including strings
// that were true of the compiler's copy of an artifact and never true of the
// delivered one. personal-injury/index.html asserted "Truck accident lawyer near me
// how to choose?" for a checklist whose accepted copy lists a different question -
// an unsatisfiable promise, held across every recompile because the entry was never
// recompiled. Fresh entries already derive their strings through
// mergeAcceptedArtifacts (see html_fix_acceptance_parser.js); carried entries are
// put through the same question here rather than being trusted.
//
// Only strings the merged artifacts do not contain are dropped, so nothing a page
// genuinely publishes stops being asserted, and an entry that loses every string
// keeps its row requirements and headings - the substantive part of the contract.
//
// min_rows is re-derived here for the same reason and from the same source. It was
// written once at compile time as `built.rows.length` and never revisited, so a block
// still demanded the row count the artifact had BEFORE its padding was screened off.
// The delivered artifact is the authority on how many rows exist, so the count is
// taken from it. It is only ever LOWERED: raising it would assert rows nothing has
// shown the page to have, which is the same mistake one column over.
//
// ON A FROZEN ROUTE THE ACCEPTED BYTES ARE THE ANSWER, NOT THE COMPILER'S ARTIFACTS.
//
// build_site.js ends with restoreFrozenPages(), which puts 1,879 of 2,069 routes back
// byte-for-byte from the accepted store. For those routes recompiling the manifest
// cannot change one character of what a reader or a crawler sees, so a promise
// derived from this run's artifacts is not a statement about the page at all.
//
// That is the whole of the residual failure after the scaffolding screen above.
// /trt/ is frozen; its accepted HTML carries three rows under "Before starting TRT if
// fertility matters", the freshly compiled artifact carries four, and the manifest
// asserted four:
//
//   trt/index.html:row:agent_216e7290b4e17f8d:min_rows_not_met:3<4
//   trt/community-questions/how-long-until-trt-works/index.html:missing_required_string:Body composition
//
// Neither is satisfiable by any amount of rebuilding, and neither describes a
// defect - the manifest was simply measuring the wrong artifact.
//
// So a frozen route is measured against its own delivered bytes, with the SAME
// functions the rendering contract will use on them (countRowsNearHeading,
// includesNormalized, imported, not restated). A mutable route keeps being measured
// against the artifacts, because there the page really is rebuilt to match them.
//
// This does not make the check inert. min_rows is still a floor and required_strings
// is still a set of promises; what changes is that the floor is now the number of
// rows the page has TODAY. A later build that drops a row, unfreezes into something
// shorter, or re-accepts a thinner block still fails - which is the shrink guard the
// accepted store exists for, and the same bargain renderedStrings already strikes
// for strings one line down.
function renderedStringsPass() {
const mutable = mutableRouteSet();
const deliveredFrozenHtml = (implementationPath) => {
  const route = normalizeRoute(String(implementationPath || ''));
  if (!route || (mutable && mutable.has && mutable.has(route))) return null;
  try { return acceptedHtmlForRoute(route) || null; } catch { return null; }
};
const blockKey = (value) => String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
const renderedStrings = (entry) => {
  const merged = mergeAcceptedArtifacts(entry.implementation_path, entry.artifacts || []);
  const rendered = JSON.stringify(merged);
  const frozenHtml = deliveredFrozenHtml(entry.implementation_path);
  const keep = (value) => rendered.includes(JSON.stringify(String(value)).slice(1, -1))
    && (!frozenHtml || includesNormalized(frozenHtml, value));
  const deliveredRowCount = new Map();
  for (const artifact of merged || []) {
    if (!artifact || !artifact.title) continue;
    const count = Array.isArray(artifact.rows) ? artifact.rows.length : (artifact.items || artifact.lines || []).length;
    deliveredRowCount.set(blockKey(artifact.title), count);
  }
  const trimBlock = (block) => {
    if (!block || !block.min_rows) return block;
    const candidates = [];
    const fromArtifact = deliveredRowCount.get(blockKey(block.heading_exact));
    if (fromArtifact !== undefined) candidates.push({ count: fromArtifact, source: 'delivered_artifact' });
    if (frozenHtml) {
      // 0 means the heading is not on the frozen page at all. The contract skips
      // min_rows entirely in that case, so there is no count to take from it.
      const fromPage = countRowsNearHeading(frozenHtml, block.heading_exact || '');
      if (fromPage > 0) candidates.push({ count: fromPage, source: 'frozen_accepted_page' });
    }
    const lowest = candidates.sort((a, b) => a.count - b.count)[0];
    if (!lowest || lowest.count >= Number(block.min_rows)) return block;
    return { ...block, min_rows: lowest.count, min_rows_source: lowest.source };
  };
  return {
    ...entry,
    required_strings: (entry.required_strings || []).filter(keep),
    row_requirements: (entry.row_requirements || []).map((row) => ({
      ...row,
      required_blocks: (row.required_blocks || []).map(trimBlock),
      required_strings: (row.required_strings || []).filter(keep)
    }))
  };
};
  return renderedStrings;
}

// A freshly compiled spec, put through every pass the durable manifest applies, in
// the order the manifest applies them. `renderedStrings` is the pass returned by
// renderedStringsPass(); callers that compile several specs build it once.
function compileDurableEntry(spec, renderedStrings) {
  const entry = compileEntryFromSpec(spec);
  if (!entry) return null;
  const cleaned = screenTemplateScaffolding(cleanCarried(entry));
  return renderedStrings ? renderedStrings(cleaned) : cleaned;
}

module.exports = { cleanCarried, screenTemplateScaffolding, renderedStringsPass, compileDurableEntry, selfConsistencyErrors };
