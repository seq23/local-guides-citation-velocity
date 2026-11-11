#!/usr/bin/env node
'use strict';
// The validation runner's source-mutation guard attributes each write to the phase
// that made it (scripts/validation/registry_lib.js mutationVerdict). Measured case,
// 11 Nov 2026: the Search Outcomes Weekly lane runs validate:release with no prior
// build, so canonical-domains runs its PREPARE (`npm run build`), which rewrites
// content/_shared/content_state.json - declared in its prepare_mutates_files. The
// runner never read that field and failed the lane on every Wednesday run, so the
// spry-weekly-summary artifact never uploaded. This reads the REAL registry entry.
const assert = require('assert');
const { readRegistry, mutationVerdict } = require('../validation/registry_lib');

const reg = readRegistry();
const v = reg.validators.find(x => x.id === 'canonical-domains');
assert(v, 'canonical-domains is missing from _validation_registry.json');
const prepareAllowed = v.prepare_mutates_files || [];
const commandAllowed = v.mutates_files || [];
// Hard fail on nothing to check: an empty declaration would make every case below vacuous.
assert(prepareAllowed.length > 0, 'canonical-domains declares no prepare_mutates_files; this test would check nothing');
assert(commandAllowed.length > 0, 'canonical-domains declares no mutates_files; this test would check nothing');
const STATE = 'content/_shared/content_state.json';
assert(prepareAllowed.includes(STATE), `canonical-domains no longer declares ${STATE} as a PREPARE write`);
assert(!commandAllowed.includes(STATE), `${STATE} must stay a PREPARE-only write`);

const verdict = (prepareChanged, commandChanged) => mutationVerdict({ prepareChanged, commandChanged, prepareAllowed, commandAllowed });

// 1. The measured case: the build's declared write is allowed.
let r = verdict([STATE], [commandAllowed[0]]);
assert.deepStrictEqual(r.forbidden, [], `PREPARE write of ${STATE} must be allowed, got ${r.forbidden}`);
assert.deepStrictEqual(r.changed, [commandAllowed[0], STATE].sort());

// 2. The same file written by the validator's own command is still forbidden.
r = verdict([], [STATE]);
assert.deepStrictEqual(r.forbiddenCommand, [STATE], 'command write of a prepare-only path must stay forbidden');
assert.deepStrictEqual(r.forbidden, [STATE]);

// 3. An undeclared file written by the PREPARE is still forbidden.
const UNDECLARED = 'content/_shared/some_other_state.json';
r = verdict([STATE, UNDECLARED], []);
assert.deepStrictEqual(r.forbiddenPrepare, [UNDECLARED], 'undeclared PREPARE write must stay forbidden');

// 4. An undeclared command write is still forbidden, and a clean run is clean.
r = verdict([], [UNDECLARED]);
assert.deepStrictEqual(r.forbidden, [UNDECLARED]);
assert.deepStrictEqual(verdict([], []).forbidden, []);

console.log('PASS test_validation_mutation_guard: PREPARE write allowed; command write of it, undeclared PREPARE write and undeclared command write forbidden (4 cases)');
