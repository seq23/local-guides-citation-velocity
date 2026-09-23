'use strict';
/**
 * The durable copy of every citation-velocity artifact that has been DELIVERED on a
 * route but that the current pipeline can no longer re-derive.
 *
 * Why this file exists
 * --------------------
 * Artifact blocks reach a page from two upstreams: `citation_velocity_artifacts` on
 * the source record, and `data/report_fixes/agent_exact_semantic_acceptance_manifest.json`
 * by way of applyAgentExactRepairsToPage/ToInsightItem. Until 2026-09-01 the semantic
 * manifest was rewritten from scratch on every compile out of the CURRENT plan, and a
 * row leaves the plan the moment it lands in the implementation ledger - so a page's
 * artifacts vanished from source on the next run. Nothing failed, because the page was
 * frozen and the frozen guard restored its accepted bytes over the thinner rebuild.
 *
 * Measured on 2026-09-01 by thawing all 2,067 accepted routes in a throwaway worktree
 * and rebuilding: 249 pages came back smaller, 1,145,001 bytes lighter in total, and
 * every byte of it was artifact blocks. 106 routes had artifacts the rebuild could not
 * produce at all - 876 of them. The frozen store was holding the only copy.
 *
 * The manifest is durable now, which stops NEW loss. It cannot recover what was
 * already dropped: the compile that would have carried those entries forward ran
 * before the fix. This store is that recovery, parsed back out of the accepted output
 * itself by scripts/lib/rendered_artifact_recovery.js, and merged in at every render
 * site so a rebuild reproduces the delivered page instead of a thinner one.
 *
 * Accepted order wins. A rebuild that produces the same artifact again is deduped
 * against the accepted copy rather than appended, and anything genuinely NEW is
 * appended after - so this store makes pages whole without freezing them against
 * future repairs.
 */

const fs = require('fs');
const path = require('path');
const { artifactKey } = require('./rendered_artifact_recovery');
const { stripTemplateScaffoldingFromArtifacts } = require('./template_scaffolding');
const { screenCrossVerticalRows } = require('./vertical_rows');

const ROOT = path.resolve(__dirname, '../..');
const STORE_REL = 'data/release/accepted_page_artifacts.json';
// Blocks a page carried at its historic maximum and lost through a thaw-rebuild-reaccept
// cycle (2026-08-24 and 2026-08-27). Recovered from git rather than from the accepted
// output, because the accepted output no longer has them. See
// scripts/citation_velocity/recover_historic_artifact_loss.js.
const HISTORIC_REL = 'data/release/historic_recovered_artifacts.json';

let CACHE = null;
function readRoutes(relPath) {
  try { return (JSON.parse(fs.readFileSync(path.join(ROOT, relPath), 'utf8')).routes) || {}; }
  catch { return {}; }
}
function loadStore() {
  if (CACHE) return CACHE;
  const accepted = readRoutes(STORE_REL);
  const historic = readRoutes(HISTORIC_REL);
  // Accepted first, historic appended: what the page still has keeps its delivered order,
  // and what it lost is restored after it rather than shuffled into the middle.
  //
  // The store was recovered by PARSING THE ACCEPTED OUTPUT, so it faithfully carries
  // whatever the delivered page carried - including 1,846 copies of "Translate “…”
  // into a specific verification question" and 852 "Concrete verification point <n>".
  // It also emits the accepted copy VERBATIM and, on a tie, lets the heavier accepted
  // block win. Fixing the compiler alone would therefore change nothing: the
  // freshly-clean, lighter block would lose the weight comparison to the placeholder
  // one and the string would come straight back on the next build. That is precisely
  // how this family shipped and stayed shipped.
  //
  // So the screen is applied to the store on load, before anything is merged or
  // weighed. Both sides shrink together, the weight comparison stays honest, and no
  // route can be re-hydrated with scaffolding this compiler no longer emits.
  const routes = {};
  for (const [key, record] of Object.entries(accepted)) routes[key] = { ...record, artifacts: stripTemplateScaffoldingFromArtifacts(record.artifacts || []) };
  for (const [key, record] of Object.entries(historic)) {
    if (!routes[key]) routes[key] = { ...record, artifacts: [] };
    routes[key].artifacts = [...routes[key].artifacts, ...stripTemplateScaffoldingFromArtifacts(record.artifacts || [])];
  }
  CACHE = { schema_version: '1.0', routes };
  return CACHE;
}
function resetCache() { CACHE = null; }

/** `/insights/x.html`, `insights/x.html`, `/dentistry/y/` and `dentistry/y/index.html` all key the same route. */
function renderedRelFor(value) {
  let out = String(value || '').trim();
  if (!out) return '';
  out = out.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/^\/+/, '');
  if (!out) return 'index.html';
  if (out.endsWith('.html')) return out;
  return `${out.replace(/\/+$/, '')}/index.html`;
}

/** The recovered artifacts for a route, or [] when nothing was ever lost there. */
function acceptedArtifactsFor(route) {
  const rel = renderedRelFor(route);
  if (!rel) return [];
  const record = loadStore().routes[rel];
  return record && Array.isArray(record.artifacts) ? record.artifacts : [];
}

// A PAIRED BLOCK KEEPS EVERY SUBJECT EITHER COPY'S INTRO NAMED.
//
// The intro under an artifact heading names the query the block was compiled for
// ("Use this table to decide what to verify before acting on <query>."), and that
// exact lowercase query is the required_marker every ledger row declares - so on
// many routes the intro is the ONLY place a delivered query appears. Replacing an
// accepted block in place (below) replaced its intro with it.
//
// Run 35801431518 (2026-09-23) is what that cost. The compiler pairs a page's
// recommendations with its queries BY LIST INDEX (html_fix_acceptance_parser.js,
// compileEntryFromSpec: `queries[index] || queries[0]`), and the two lists are
// deduplicated independently, so when the 2026-09-22 dentistry run added a new query
// at the head of dentistry/cost-financing/'s list, every block past index 6 was
// recompiled naming the new query instead of "all-on-4 dental implants price 2026".
// Six accepted cost_table blocks were that marker's only carriers; each was replaced
// by a same-titled block naming the new query, acceptMutationScope refused the
// rebuild (12 landed rows depend on the marker), and the new run's three repairs
// could never land - on any release. insights/uscis-medical-009-* lost "... (Gemini
// 1.5 Flash)" the same way, and that query is not in the plan at all, so no fix to
// the compiler's pairing alone could have kept it.
//
// So the merged block's intro is the DELIVERED intro, verbatim, plus any subject the
// other copy named that it does not already contain - appended in the same "It also
// answers: a; b." form compileEntryFromSpec already uses for surplus queries. Both
// directions: a replacement never erases the delivered subject, and an accepted copy
// that wins on weight never swallows the new query. It is idempotent - a rebuild of
// the page it produced adds nothing - so the page is stable across rebuilds.
const INTRO_SUBJECT_TEMPLATES = [
  /^(?:Use this table to decide what to verify before acting on|Compare each option against the same concrete criteria before acting on) (.+)\.$/,
  /^Use this section to answer (.+) with concrete checks, evidence, and limits\.$/,
  /^Use this section to turn (.+) into a concrete next step\.$/
];
const ALSO_ANSWERS = ' It also answers: ';
function splitIntro(intro) {
  const text = String(intro || '').replace(/\s+/g, ' ').trim();
  const at = text.indexOf(ALSO_ANSWERS);
  if (at < 0) return { lead: text, also: [] };
  const also = text.slice(at + ALSO_ANSWERS.length).replace(/\.$/, '').split('; ').map((s) => s.trim()).filter(Boolean);
  return { lead: text.slice(0, at), also };
}
function introSubjects(intro) {
  const { lead, also } = splitIntro(intro);
  if (!lead) return also;
  const template = INTRO_SUBJECT_TEMPLATES.map((re) => lead.match(re)).find(Boolean);
  return [template ? template[1] : lead.replace(/\.$/, ''), ...also];
}
function unionIntro(deliveredIntro, otherIntro) {
  const delivered = String(deliveredIntro || '').replace(/\s+/g, ' ').trim();
  if (!delivered) return otherIntro;
  const missing = [...new Set(introSubjects(otherIntro))].filter((subject) => subject && !delivered.includes(subject));
  if (!missing.length) return deliveredIntro;
  const { lead, also } = splitIntro(delivered);
  return `${lead}${ALSO_ANSWERS}${[...also, ...missing].join('; ')}.`;
}
function withUnionIntro(winner, delivered, other) {
  if (!winner || !delivered) return winner;
  const intro = unionIntro(delivered.intro, other && other.intro);
  return intro === winner.intro ? winner : { ...winner, intro };
}

/**
 * Accepted artifacts first, in the order they were delivered, then anything the
 * current build produces that the accepted output did not carry.
 *
 * Every page render site goes through here, so this is also where lawyer row copy
 * is kept off non-personal-injury routes (scripts/lib/vertical_rows.js) - whichever
 * store the block came from.
 */
function mergeAcceptedArtifacts(route, current) {
  return screenCrossVerticalRows(mergeAcceptedArtifactsUnscreened(route, current), route);
}
function mergeAcceptedArtifactsUnscreened(route, current) {
  const accepted = acceptedArtifactsFor(route);
  if (!accepted.length) return Array.isArray(current) ? current : [];
  // The accepted list is emitted VERBATIM, duplicates included.
  //
  // A first cut keyed the accepted list into a Map to dedupe it, which quietly ate
  // real content: /neuro/ carries two different comparison tables both titled "Direct
  // answer" - same type, same heading, different rows - and the second one vanished.
  // Deduping the delivered page against itself is the same silent loss this store
  // exists to stop. Only what the CURRENT build produces is deduped, and only against
  // what the accepted output already carries.
  //
  // A CURRENT block with an accepted block's key REPLACES it in place; it does not
  // lose to it. Dropping the current copy froze every accepted route against its own
  // future repairs: the 2026-09-01 absorption pass re-resolved seven TRT targets, the
  // ledger issued fresh markers for them, insights.json carried the new markers - and
  // the rendered pages kept the previous run's marker forever, because the repair
  // block has the same type and title every time and so always lost the dedupe. The
  // trace then reported repair_not_proven on a repair that had genuinely been made.
  //
  // Position and count come from the accepted list, so nothing is reordered and the
  // two same-titled /neuro/ tables both survive. Only the CONTENT is refreshed, and
  // only upward: a current block shorter than the accepted one is the shrink this
  // store exists to prevent, so in that case the accepted copy stands.
  //
  // ONE EXCEPTION, and only one: a current block carrying an agent-exact marker
  // that the accepted copy does not carry is a REPAIR, not the accidental shrink
  // this store exists to catch. The marker is minted per repair as
  // hash(record_ids | implementation_path) and stamped onto the FIRST semantic
  // artifact (scripts/lib/agent_exact_repairs.js artifactsWithMarker), so which
  // block carries it is decided by the semantic manifest, not by size - and on
  // /personal-injury/ it landed on `cost_table|"Direct answer,"`, a key the
  // accepted store holds three copies of. The freshly authored 939-byte block was
  // paired with the 1066-byte accepted one, lost the weight comparison, and was
  // then consumed - dropped entirely, not appended. The page kept the previous
  // run's marker forever, and agent-exact-implementation-trace correctly reported
  // agent_db794554f0377d3c:repair_not_proven:personal-injury/index.html, which is
  // what took Velocity Content Release red on run 34197241611.
  //
  // Letting the repair land does not reopen the shrink hole. A thawed route's
  // rebuild is still adjudicated by route_marker_preservation inside
  // acceptMutationScope: if it loses any ledgered marker another row depends on,
  // the accepted bytes are put back and the route is recorded in
  // mutation-scope-acceptance.json `rejected`, which the trace then reads as a
  // NAMED refusal instead of a failure. That guard, not a byte count, is what
  // decides whether a repair may replace delivered content - and it accepted all
  // 17 thawed routes with 0 rejected when this exception was introduced.
  const pending = new Map();
  for (const artifact of Array.isArray(current) ? current : []) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    const key = artifactKey(artifact);
    if (!pending.has(key)) pending.set(key, []);
    pending.get(key).push(artifact);
  }
  // BOTH SIDES ARE WEIGHED AFTER SCREENING, AND THAT IS DELIBERATE.
  //
  // Weighing the accepted side at its PRE-screen size was tried and reverted. It is
  // the more principled-sounding rule - "the screen may change what a block says,
  // never which block wins" - and it does fix
  // /insights/uscis-medical-009-how-much-does-the-exam-cost.html, whose accepted
  // cost_table would otherwise lose to the rebuild and take the ledgered marker in
  // its intro with it. But it cannot hold both ends: the CURRENT side got lighter too
  // when the compiler stopped padding, and there is no pre-fix weight for it. Applied
  // to the accepted side alone it simply moved the failure, handing /personal-injury/
  // to the accepted copy and losing "how should i preserve and compare evidence after
  // an accident" from the rebuild's intro - a hub page, for a long-tail insight.
  //
  // Screened-vs-screened is the comparison that stays internally consistent. The one
  // route it cannot repair is named in data/content/template_scaffolding_deferred.json
  // with the measured reason.
  const weight = (artifact) => JSON.stringify(artifact || '').length;
  const consumed = new Set();
  const out = [];
  for (const artifact of accepted) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    const key = artifactKey(artifact);
    const queue = pending.get(key) || [];
    const replacement = queue.shift();
    if (replacement) {
      consumed.add(replacement);
      const carriesFreshMarker = Boolean(replacement.marker) && replacement.marker !== artifact.marker;
      const winner = carriesFreshMarker || weight(replacement) >= weight(artifact) ? replacement : artifact;
      out.push(withUnionIntro(winner, artifact, replacement));
    } else out.push(artifact);
  }
  for (const artifact of Array.isArray(current) ? current : []) {
    if (!artifact || !artifact.type || !artifact.title) continue;
    if (consumed.has(artifact)) continue;
    out.push(artifact);
  }
  return out;
}

module.exports = { STORE_REL, HISTORIC_REL, acceptedArtifactsFor, mergeAcceptedArtifacts, renderedRelFor, resetCache, unionIntro, introSubjects };
