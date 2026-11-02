'use strict';
// Owner ruling 2 Nov 2026: under a floor fails only below 75% of it; over never fails.
const test = require('node:test');
const assert = require('node:assert');
const { belowHardFloor, softShortfall, hardFloor, selfTest } = require('../lib/floor_rule');

test('a value at 75% of the floor passes; one under it fails', () => {
  assert.strictEqual(hardFloor(120), 90);
  assert.strictEqual(belowHardFloor(90, 120), false);
  assert.strictEqual(belowHardFloor(89, 120), true);
  assert.strictEqual(belowHardFloor(187, 250), true);
  assert.strictEqual(belowHardFloor(188, 250), false);
});

test('over any length never fails', () => {
  assert.strictEqual(belowHardFloor(100000, 30), false);
});

test('a near miss is a note, not a failure', () => {
  assert.strictEqual(softShortfall(110, 120), true);
  assert.strictEqual(softShortfall(80, 120), false);
});

test('the built-in fixture the validators run holds', () => {
  assert.deepStrictEqual(selfTest(), []);
});
