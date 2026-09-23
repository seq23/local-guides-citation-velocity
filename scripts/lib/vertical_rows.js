'use strict';

/**
 * PERSONAL-INJURY ROW COPY BELONGS ON PERSONAL-INJURY ROUTES ONLY.
 *
 * scripts/lib/html_fix_acceptance_parser.js tableRowForRequirement() used to answer a
 * table row by matching the requirement text against a handful of factors that were
 * written for choosing an injury lawyer - and it matched on words that every vertical
 * uses. /fee|cost/ alone put
 *
 *     Get the contingency percentage, case-cost handling, and any trial-stage fee
 *     changes in writing.  |  Slogan-heavy firms often hide the real economic terms
 *     until after intake.
 *
 * into the "What to verify" column of 30 rendered dental, TRT, neuro and USCIS pages
 * (measured 2026-09-23), and /pressure/ ("blood pressure") put "Ask what happens if the
 * insurer will not make a fair offer" on 5 TRT and dentistry pages. The review agent
 * asked in successive dentistry reports to "replace the placeholder cost rows"; every
 * rebuild put them back, because the accepted-artifact store re-emits delivered copy.
 *
 * One list, three readers - so no reader keeps its own copy:
 *   - the compiler (tableRowForRequirement) only offers these rows on a PI route;
 *   - screenCrossVerticalRows() rewrites the lawyer copy in delivered blocks on every
 *     other route, at the one render choke point every page goes through
 *     (scripts/lib/accepted_artifacts.js mergeAcceptedArtifacts) and in the committed
 *     migration (scripts/citation_velocity/migrate_cross_vertical_rows.js);
 *   - the rendered-page gate (validate_rendered_template_scaffolding.js) fails any
 *     non-PI page that still publishes one of these cells.
 *
 * CELL ONE IS NEVER TOUCHED. It carries the requirement, and a requirement can be a
 * ledgered marker that landed rows depend on (the 2026-09-10 cost-insurance lesson in
 * template_scaffolding.js): acceptMutationScope refuses a rebuild that loses one. Only
 * the lawyer copy in the guidance cells is replaced, with the same honest,
 * vertical-neutral sentence the compiler already emits for any requirement it has no
 * specific copy for. Nothing is invented.
 */

const { READER_FACING_VERIFICATION_CELL } = require('./template_scaffolding');

// The third cell of the generic row. Same sentence tableRowForRequirement has always
// emitted for a requirement with no specific copy.
const NEUTRAL_WHY_CELL = 'Specific, written answers are more reliable than broad marketing claims.';

// [requirement pattern, row]. Order matters: first match wins, exactly as the
// compiler's if-chain did.
const PERSONAL_INJURY_ROWS = [
  [/accident type fit/i, ['Accident type fit', 'Ask whether the attorney routinely handles your exact accident type, not just personal injury generally.', 'Car, truck, workplace, slip-and-fall, rideshare, and hit-and-run claims have different evidence, insurance, and deadline issues.']],
  [/plaintiff-side/i, ['Plaintiff-side injury focus', 'Confirm the lawyer represents injured people and can explain the claim from the victim side.', 'A general litigator or defense-heavy practice may not be built for settlement pressure, medical proof, and insurer negotiation.']],
  [/fee|cost/i, ['Fee and cost clarity', 'Get the contingency percentage, case-cost handling, and any trial-stage fee changes in writing.', 'Slogan-heavy firms often hide the real economic terms until after intake.']],
  [/staffing|communication/i, ['Case staffing and communication', 'Ask who handles the file day to day and how often you will receive updates.', 'The lawyer on the ad may not be the person managing evidence, treatment records, negotiations, or settlement decisions.']],
  [/trial readiness|pressure/i, ['Trial readiness and pressure tactics', 'Ask what happens if the insurer will not make a fair offer, and pause if the firm pressures you to sign immediately.', 'Real leverage comes from preparation and clear options, not urgency language or “best lawyer” claims.']],
  [/written next steps/i, ['Written next steps', 'Ask for the next three steps, expected documents, and near-term timeline before signing.', 'A clear written process is easier to compare than reviews, awards, badges, or vague promises.']]
];

// Every lawyer-specific GUIDANCE cell (cells two and three). Cell-one labels are not
// here on purpose - see the header.
const PERSONAL_INJURY_GUIDANCE_CELLS = PERSONAL_INJURY_ROWS.flatMap(([, row]) => [row[1], row[2]]);
const GUIDANCE_KEYS = new Set(PERSONAL_INJURY_GUIDANCE_CELLS.map((cell) => normalizeCell(cell)));

function normalizeCell(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * `personal-injury/...` and `insights/personal-injury-...` in any spelling a caller
 * uses: `/personal-injury/`, `personal-injury/index.html`, a full URL.
 */
function isPersonalInjuryRoute(route) {
  const rel = String(route || '').trim().replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '').replace(/^\/+/, '');
  return /^personal-injury(?:\/|$)/.test(rel) || /^insights\/personal-injury-/.test(rel);
}

/** The PI row for a requirement, or null. Callers must check the route first. */
function personalInjuryRowFor(requirement) {
  const r = String(requirement || '');
  for (const [pattern, row] of PERSONAL_INJURY_ROWS) if (pattern.test(r)) return [...row];
  return null;
}

/** True when this exact cell is lawyer guidance copy from the PI row table. */
function isPersonalInjuryGuidanceCell(value) {
  return GUIDANCE_KEYS.has(normalizeCell(value));
}

/** Rewrite the lawyer guidance in one row; cell one is returned untouched. */
function neutralizeRow(row) {
  if (!Array.isArray(row)) return row;
  if (!row.slice(1).some(isPersonalInjuryGuidanceCell)) return row;
  return row.map((cell, index) => {
    if (index === 0 || !isPersonalInjuryGuidanceCell(cell)) return cell;
    return index === 1 ? READER_FACING_VERIFICATION_CELL : NEUTRAL_WHY_CELL;
  });
}

/**
 * Screen a route's artifacts. A PI route is returned unchanged (same array). On any
 * other route every table row's lawyer guidance is rewritten; an artifact that needed
 * no change is returned as the same object, so callers can tell what moved.
 */
function screenCrossVerticalRows(artifacts, route) {
  if (!Array.isArray(artifacts) || isPersonalInjuryRoute(route)) return artifacts;
  return artifacts.map((artifact) => {
    if (!artifact || !Array.isArray(artifact.rows)) return artifact;
    const rows = artifact.rows.map(neutralizeRow);
    return rows.some((row, i) => row !== artifact.rows[i]) ? { ...artifact, rows } : artifact;
  });
}

module.exports = {
  NEUTRAL_WHY_CELL,
  PERSONAL_INJURY_ROWS,
  PERSONAL_INJURY_GUIDANCE_CELLS,
  isPersonalInjuryRoute,
  personalInjuryRowFor,
  isPersonalInjuryGuidanceCell,
  neutralizeRow,
  screenCrossVerticalRows
};
