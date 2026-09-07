'use strict';
/**
 * A validator that examined nothing has not passed.
 *
 * Six of the eight validators in the Velocity recommendation-driven-output suite ended
 * a run over an empty collection and printed PASS: agent-run-artifact-intake with no
 * manifests, agent-exact-implementation-plan with no specs, html-fix-acceptance-compiler
 * and agent-exact-acceptance-manifest with no entries, agent-exact-implementation-trace
 * with no traces, velocity-agent-recommendation-driven-output with no recommendations.
 * "Nothing was checked" and "everything checked was correct" printed the same word, so
 * an input pipeline that silently stopped producing work would have read as a healthy
 * release for as long as it kept producing nothing.
 *
 * Both halves matter, and they are different outcomes:
 *
 *  - Items were AVAILABLE and none were examined. That is a defect in the validator or
 *    in what feeds it, and it FAILS.
 *  - Nothing was available. That is a legitimate refusal to act, and it must be GREEN -
 *    but loud, named, and recorded in the evidence file, never a silent PASS.
 *
 * `available` must be derived from something OTHER than the collection being examined,
 * or this proves nothing.
 */
function zeroExaminationVerdict({ validator, unit, examined, available = 0, stopReason, inputs = [] }) {
  const seen = Number(examined) || 0;
  const have = Number(available) || 0;
  if (seen > 0) return { examined: seen, error: null, named_stop: null };
  if (have > 0) {
    return {
      examined: 0,
      error: `${validator}:examined_nothing (unit: ${unit}) while ${have} were present - a validator that examines nothing has not passed`,
      named_stop: null
    };
  }
  const namedStop = { validator, unit, reason: stopReason, inputs_read: inputs, examined: 0 };
  console.log(`NAMED STOP: ${validator} examined zero ${unit} - ${stopReason}`);
  console.log(`  inputs read: ${inputs.join(', ') || '(none declared)'}`);
  console.log('  This is a stop, not a pass: nothing was checked because nothing was there to check.');
  return { examined: 0, error: null, named_stop: namedStop };
}

module.exports = { zeroExaminationVerdict };
