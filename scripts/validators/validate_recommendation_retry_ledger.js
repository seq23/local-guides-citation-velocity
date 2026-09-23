#!/usr/bin/env node
'use strict';
// Pure-code check of the retry ledger on constructed rows; no repo content can change its answer.
const fs = require('fs'); const os = require('os'); const path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-ledger-'));
process.env.RECOMMENDATION_RETRY_LEDGER = path.join(tmp, 'ledger.json');
const { recordOutcomes, escalated, read, ESCALATE_AFTER } = require('../lib/recommendation_retry_ledger');
const failures = [];
const expect = (cond, msg) => { if (!cond) failures.push(msg); };
const miss = { id: 'a', implementation_status: 'ACCEPTED_ROUTE_MARKERS_ABSENT', renderedPath: 'p/index.html', query: 'q' };
const why = () => 'required_markers_absent';

recordOutcomes([miss], ['a'], '2026-01-01', why);
expect(read().entries.a.attempts === 1, 'a first miss records one attempt');
recordOutcomes([miss], ['a'], '2026-01-01', why);
expect(read().entries.a.attempts === 1, 're-running the same release date does not count twice');
recordOutcomes([miss], ['a'], '2026-01-02', why);
expect(escalated().length === 0, `not escalated before ${ESCALATE_AFTER} misses`);
recordOutcomes([miss], ['a'], '2026-01-03', why);
expect(escalated().map((e) => e.id).join() === 'a', `escalated at ${ESCALATE_AFTER} misses`);
expect(read().entries.a.first_missed === '2026-01-01', 'first_missed is kept across attempts');
recordOutcomes([{ ...miss, id: 'b' }], [], '2026-01-04', why);
expect(!read().entries.b, 'a row this release did not attempt is not counted');
recordOutcomes([{ ...miss, implementation_status: 'RELEASED_VERIFIED' }], ['a'], '2026-01-04', why);
expect(!read().entries.a && escalated().length === 0, 'a row that lands leaves the ledger and its escalation');

fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) { console.error(`RECOMMENDATION RETRY LEDGER FAIL:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('RECOMMENDATION RETRY LEDGER PASS: 7 behaviours proven on constructed rows.');
