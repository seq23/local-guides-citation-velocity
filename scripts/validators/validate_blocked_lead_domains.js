#!/usr/bin/env node
'use strict';
// Registry entry point for the blocked-lead-domains validator. The cases live in
// scripts/tests/test_blocked_lead_domains.mjs (ESM, because the Pages handler is
// ESM); this runs them and fails on any assertion or import error.
const path = require('path');
const { pathToFileURL } = require('url');
import(pathToFileURL(path.join(__dirname, '../tests/test_blocked_lead_domains.mjs')).href).catch((e) => {
  console.error(`blocked-lead-domains: FAIL ${e && e.message ? e.message : e}`);
  process.exit(1);
});
