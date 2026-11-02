'use strict';

/**
 * The one rule every length floor in this repo follows (owner ruling, personal
 * brain, 2 Nov 2026: "No petty validation in any repo").
 *
 *   - Over a ceiling NEVER fails. The generator trims (scripts/lib/search_snippet.js
 *     trimTo / fitTitle / fitDescription); a validator may count it as a note.
 *   - Under a floor fails ONLY below FLOOR_FAIL_RATIO of the floor. Between that
 *     and the floor is a note: a reader would not notice a 110-character
 *     description where 120 was asked for, so it never turns a run red.
 *
 * Every validator that grades a length imports belowHardFloor from here, so the
 * 75% is one number, not a copy in each file.
 */

const FLOOR_FAIL_RATIO = 0.75;

/** The smallest value that still passes a floor: 75% of it, rounded up. */
function hardFloor(floor) {
  return Math.ceil(Number(floor) * FLOOR_FAIL_RATIO);
}

/** True only when `value` is below 75% of `floor` - the one case that fails. */
function belowHardFloor(value, floor) {
  return Number(value) < hardFloor(floor);
}

/** True when `value` is under the floor but not below 75% of it: a note, never a failure. */
function softShortfall(value, floor) {
  return Number(value) < Number(floor) && !belowHardFloor(value, floor);
}

/**
 * Fixture proof the rule holds; validators call it so a regression in the helper
 * turns their own run red. Returns a list of broken cases (empty = holds).
 */
function selfTest() {
  const broken = [];
  const cases = [
    // [value, floor, expected belowHardFloor]
    [120, 120, false], [90, 120, false], [89, 120, true], [0, 120, true],
    [30, 30, false], [23, 30, false], [22, 30, true],
    [250, 250, false], [188, 250, false], [187, 250, true],
    [10000, 120, false]
  ];
  for (const [v, f, want] of cases) {
    if (belowHardFloor(v, f) !== want) broken.push(`belowHardFloor(${v}, ${f}) should be ${want}`);
  }
  if (!softShortfall(100, 120)) broken.push('softShortfall(100, 120) should be true');
  if (softShortfall(80, 120)) broken.push('softShortfall(80, 120) should be false (that one fails)');
  return broken;
}

module.exports = { FLOOR_FAIL_RATIO, hardFloor, belowHardFloor, softShortfall, selfTest };
