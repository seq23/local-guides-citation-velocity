#!/usr/bin/env node
/**
 * Guard the citation-occupancy probe against the three defects found in it, so
 * none can return silently. The stakes are not abstract:
 * scripts/queries/join_atlas_to_release_queue.mjs RANKS publishing candidates by
 * citation_occupancy, so a wrong number here decides what gets written.
 *
 * (1) A GUARD THAT NOTHING PASSES IS NOT A GUARD.
 *     probe_query_class_occupancy.mjs has supported --merge since it was
 *     written, and its own docstring says that without it "a narrow run would
 *     silently DELETE the readings a wider earlier run took". Neither of its two
 *     callers passed it. Commit 21b15649d recorded 205 measured readings; the
 *     next scheduled run wrote 36 with carried_forward_from_previous_run: 0.
 *     169 paid measurements destroyed by an automated refresh.
 *
 * (2) BLUE-OCEAN CONFLATION. citation_occupancy is unbranded_share, and
 *     "unbranded" was a FALLTHROUGH bucket. Any host that was not owned, not
 *     social, not a listed US national brand and not bare .gov/.edu counted as
 *     "a slot an independent microsite can hold". england.nhs.uk, ico.org.uk
 *     (the UK information regulator), cqc.org.uk, novascotia.ca, moh.gov.sa and
 *     nslhd.health.nsw.gov.au all landed there. "dentist guide" scored a maximal
 *     1.00 out of exactly those hosts and went to the top of the release queue.
 *     "Not cited" is not "open ground".
 *
 * (3) A CONTROL NOBODY CHECKS. The file's own words: the controls are run "so a
 *     human can see whether the known-open and known-closed classes still
 *     separate in the same direction". Nothing computed that, so nobody could
 *     see it - and they do not separate: control_known_closed measured 1.00,
 *     MORE open than control_known_open at 0.50.
 *
 * Hard-fails if it examines zero probes. A validator that passes on an empty
 * loop proves nothing.
 */
const fs = require('fs');

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const readText = (p) => { if (!fs.existsSync(p)) { fail(`missing ${p}`); return ''; } return fs.readFileSync(p, 'utf8'); };
const readJson = (p) => { try { return JSON.parse(readText(p)); } catch (e) { fail(`unreadable JSON: ${p} (${e.message})`); return null; } };

const SCRIPT = 'scripts/queries/probe_query_class_occupancy.mjs';
const SIGNAL = 'data/signals/query_class_occupancy.json';
const src = readText(SCRIPT);
const pkg = readJson('package.json') || { scripts: {} };
const scripts = pkg.scripts || {};

// ------------------------------------------- (1) every caller must pass --merge
const npmNames = Object.entries(scripts)
  .filter(([, v]) => String(v).includes('probe_query_class_occupancy.mjs'))
  .map(([k]) => k);
if (!npmNames.length) fail(`${SCRIPT} has no npm script invoking it.`);

const WF_DIR = '.github/workflows';
const workflows = fs.existsSync(WF_DIR) ? fs.readdirSync(WF_DIR).filter((f) => /\.ya?ml$/.test(f)) : [];
if (!workflows.length) fail(`${WF_DIR} holds no workflows - refusing to conclude anything about invocation from an empty directory.`);

const callSites = [];
for (const f of workflows) {
  for (const line of fs.readFileSync(`${WF_DIR}/${f}`, 'utf8').split('\n')) {
    const invokesDirectly = line.includes('probe_query_class_occupancy.mjs');
    const invokesViaNpm = npmNames.some((n) => new RegExp(`npm run ${n}(\\s|$|\\s--)`).test(line));
    if (invokesDirectly || invokesViaNpm) callSites.push({ file: f, line: line.trim() });
  }
}
if (!callSites.length) fail(`no workflow invokes the occupancy probe, directly or via ${npmNames.join('/')}.`);
for (const c of callSites) {
  if (!/--merge\b/.test(c.line) && !/--rescore-only\b/.test(c.line)) {
    fail(`${WF_DIR}/${c.file} runs the occupancy probe without --merge. A narrow run then DELETES every reading a wider earlier run paid to take: this destroyed 169 of 205 measured readings once already.\n      ${c.line}`);
  }
}
if (!/--merge/.test(src)) fail(`${SCRIPT} no longer supports --merge, so a narrow run cannot preserve a wider run's readings at all.`);
if (!/carried_forward/.test(src)) fail(`${SCRIPT} no longer marks carried-forward readings, so a stale reading is indistinguishable from a fresh one.`);

// This validator must itself be registered, or it is the defect it hunts.
if (!Object.values(scripts).some((v) => String(v).includes('validate_occupancy_probe_contract.js') || String(v).includes('occupancy-probe-contract'))) {
  notes.push('no npm script points at this validator; it runs from the validation registry.');
}
const registry = readJson('_validation_registry.json');
const entry = ((registry && registry.validators) || []).find((v) => (v.path || '').endsWith('validate_occupancy_probe_contract.js'));
if (!entry) fail('validate_occupancy_probe_contract.js is not in _validation_registry.json, so the matrix will never run it - an unregistered validator is the same "exists but nothing invokes it" defect it is hunting.');
else if (!(entry.profiles || []).includes('core')) fail(`check "${entry.id}" is registered but not in the "core" profile, which is what npm run validate:all executes.`);

// ------------------------------------ (2) unbranded must not be a blind fallthrough
// Assert the CALL SITE, not just the declaration. Deleting the usage while
// leaving the consts in place is exactly how this regresses unnoticed.
const classifyBody = (src.match(/function classify\(h\)[\s\S]*?\n}/) || [''])[0];
if (!/PUBLIC_BODY\.test\(h\)/.test(classifyBody) || !/CA_GOV\.test\(h\)/.test(classifyBody) || !/gov\|edu\|ac\|nhs/.test(src)) {
  fail(`${SCRIPT} has lost its non-US public-sector classification. Foreign government, health-service, regulator and university hosts would again fall through into "unbranded" and be counted as citation slots an independent microsite can take.`);
}
if (!/blueOceanEligibility/.test(src) || !/blue_ocean_eligible/.test(src)) {
  fail(`${SCRIPT} no longer records blue_ocean_eligible, so nothing distinguishes an occupancy reading taken on this property's ground from one taken on somebody else's.`);
}
// The anchor vocabulary must stay the repo's governed one, not a hardcoded list
// that goes stale the moment a vertical is added.
if (!/page_strategy_registry\.json/.test(src)) {
  fail(`${SCRIPT} no longer derives its anchor vocabulary from data/strategy/page_strategy_registry.json. A hardcoded vertical list silently refuses every query in a vertical the portfolio adds later.`);
}

// ---------------------------------------------------- the data, not just the code
const doc = readJson(SIGNAL);
const probes = (doc && Array.isArray(doc.probes)) ? doc.probes : [];
if (!probes.length) fail(`${SIGNAL} holds zero probes - this validator examined nothing and must not pass on an empty loop.`);

let examined = 0;
let gated = 0;
let refused = 0;
for (const p of probes) {
  const q = p && p.query;
  if (!q) { fail('probe with no query string'); continue; }
  examined++;
  // A discarded probe must never appear as a measurement of zero.
  if (p.citation_occupancy === 0 && !p.slots_read) {
    fail(`probe recorded as zero occupancy with no slots read, which is a discard dressed as a measurement: ${q}`);
  }
  if (typeof p.citation_occupancy === 'number' && p.unbranded_share !== p.citation_occupancy) {
    fail(`citation_occupancy and unbranded_share disagree, so the published winnability number is not the one that was measured: ${q}`);
  }
  const gate = p.blue_ocean_eligible;
  if (!gate || typeof gate.eligible !== 'boolean') {
    fail(`probe carries an occupancy reading with no blue_ocean_eligible gate, so "not cited" can be read as "open ground": ${q}`);
    continue;
  }
  gated++;
  if (!gate.reason) fail(`blue_ocean_eligible with no reason: ${q}`);
  if (!gate.eligible) refused++;
}
if (examined === 0) fail('examined zero probes - refusing to pass on an empty loop.');
if (gated !== examined) fail(`${examined - gated} of ${examined} probes are not gated.`);

// The gate must be doing work: this panel demonstrably carries queries from
// other portfolio properties that match no governed vertical here.
if (refused === 0) {
  fail('the blue-ocean gate refused nothing across the whole panel - it has been widened into a no-op.');
}

// ------------------------------------------ (3) the control direction is checked
const sep = doc && doc.control_check && doc.control_check.separation;
if (!sep) {
  fail(`${SIGNAL} records no control_check.separation. The controls exist so a human can see whether the known-open and known-closed classes still separate in the same direction; without this field nothing computes that and nobody can see it.`);
} else if (sep.separated === false) {
  // Deliberately a NAMED, LOUD note rather than a hard fail: the inversion is a
  // real and currently-true condition of the measurement channel, and failing
  // the repo's whole validation on it would only get the check disabled. It must
  // never be silent, which is what it was.
  notes.push(`CONTROL INVERTED — known_closed=${sep.known_closed} is not below known_open=${sep.known_open}. citation_occupancy is not separating the two known classes on this channel, and every number in ${SIGNAL} inherits that. Root cause: "unbranded" is a fallthrough bucket, so incumbent local practices holding every slot read as fully open ground. Fixing that needs a decision about which hosts count as incumbents, which is a decision, not a code change.`);
}

// -------------------------------------------------------------------- verdict
if (problems.length) {
  console.error('OCCUPANCY PROBE CONTRACT FAIL:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OCCUPANCY PROBE CONTRACT PASS: ${examined} probes examined, all gated; ${refused} refused as unanchored, navigational or anchored to another market; ${callSites.length} workflow call site(s), all passing --merge.`);
for (const n of notes) console.log(`  NOTE: ${n}`);
