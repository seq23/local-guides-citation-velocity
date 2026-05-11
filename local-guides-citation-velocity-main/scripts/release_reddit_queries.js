#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';
require('./compile_reddit_queries.js');
process.argv[2] = String(process.argv[2] || 5);
require('./release_batch.js');
