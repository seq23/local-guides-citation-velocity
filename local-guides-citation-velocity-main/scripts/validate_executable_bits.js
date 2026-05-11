#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, EXECUTABLE_FILES_PATH, loadJson } = require('./lib/publish_contract');
function fail(msg) { console.error('VALIDATION FAIL:', msg); process.exitCode = 1; }
const payload = loadJson(EXECUTABLE_FILES_PATH);
for (const rel of payload.files || []) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) { fail(`Executable contract file missing: ${rel}`); continue; }
  const mode = fs.statSync(fp).mode & 0o111;
  if (!mode) fail(`Executable bit missing: ${rel}`);
}
if (!process.exitCode) console.log(`Executable bit validation passed (${(payload.files || []).length} files).`);
