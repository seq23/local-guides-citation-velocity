#!/usr/bin/env node
'use strict';
/**
 * _repo_validation_matrix.json is a COMMITTED projection of _validation_registry.json.
 * The pair travels together in one commit; validation-registry hard-fails on
 * `matrix:not-generated-from-current-registry` when it does not.
 *
 * --check exists because regenerating it inside the validation lane HID that failure.
 *
 * PR #93 changed one string in _validation_registry.json and did not regenerate the
 * matrix. Validate Repo went green anyway, because `release:ci-validate` ran this
 * generator as the `validation-matrix-refresh` stage a few stages BEFORE
 * `validation-registry` compared the two - so the check was handed a file the same run
 * had just repaired. The desync landed on main, and the lanes that do NOT run this
 * generator first - Velocity Content Release and Query Evidence Refresh, both of which
 * go straight into the self-heal loop - failed on it every run from 2026-09-08 onward,
 * with no registered repair, which is what put both of them red.
 *
 * A validation lane must not repair the thing it is about to check. The stage now
 * ASSERTS parity instead of restoring it, so the desync fails on the change that
 * introduces it rather than three lanes later. `validation-lane-repairs-nothing`
 * hard-fails if a producing command is ever put back into the validate stage list.
 */
const fs=require('fs');
const path=require('path');
const {ROOT,readRegistry,buildMatrix}=require('./registry_lib');
const MATRIX_REL='_repo_validation_matrix.json';
const check=process.argv.slice(2).includes('--check');
const matrix=buildMatrix(readRegistry());
const expected=JSON.stringify(matrix,null,2)+'\n';
const target=path.join(ROOT,MATRIX_REL);
if(check){
 const actual=fs.existsSync(target)?fs.readFileSync(target,'utf8'):null;
 if(actual===null){
  console.error(`VALIDATION MATRIX PARITY FAIL: ${MATRIX_REL} does not exist. It is the committed projection of _validation_registry.json; run "npm run validation:matrix" and commit it.`);
  process.exit(1);
 }
 if(actual!==expected){
  console.error(`VALIDATION MATRIX PARITY FAIL: ${MATRIX_REL} is not the projection of the committed _validation_registry.json (${matrix.counts.total} registered validators). Whoever edited the registry did not regenerate the matrix in the same change. Run "npm run validation:matrix" and commit BOTH files. This stage deliberately does not rewrite it for you: repairing it here is what hid the same desync on 2026-09-08 and reds every lane that goes straight into self-heal.`);
  process.exit(1);
 }
 console.log(`VALIDATION MATRIX PARITY PASS: ${MATRIX_REL} is byte-identical to the projection of the committed _validation_registry.json (${matrix.counts.total} registered validators, ${matrix.dependency_edges.length} dependency edges).`);
 process.exit(0);
}
fs.writeFileSync(target,expected);
console.log(`VALIDATION MATRIX GENERATED (${matrix.counts.total} registered validators)`);
