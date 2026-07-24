#!/usr/bin/env node
'use strict';
const {
  seedAcceptedPages, freezeRoute, freezeNewAdmitted, restoreFrozenPages, verifyFrozenPages,
  beginMutationScope, acceptMutationScope, rollbackMutationScope, loadRegistry
} = require('./lib/frozen_pages');

function usage() {
  console.log(`Usage:
  node scripts/frozen_pages.js seed-accepted [--missing-only]
  node scripts/frozen_pages.js restore
  node scripts/frozen_pages.js verify
  node scripts/frozen_pages.js freeze-route <route>
  node scripts/frozen_pages.js freeze-new-admitted
  node scripts/frozen_pages.js begin <release-id> <route...>
  node scripts/frozen_pages.js accept
  node scripts/frozen_pages.js rollback
  node scripts/frozen_pages.js status`);
}
const [cmd, ...args] = process.argv.slice(2);
try {
  let result;
  if (cmd === 'seed-accepted') result = seedAcceptedPages({ onlyMissing: args.includes('--missing-only') });
  else if (cmd === 'restore') result = restoreFrozenPages();
  else if (cmd === 'verify') result = verifyFrozenPages();
  else if (cmd === 'freeze-route') result = freezeRoute(args[0]);
  else if (cmd === 'freeze-new-admitted') result = freezeNewAdmitted();
  else if (cmd === 'begin') result = beginMutationScope(args.slice(1), args[0]);
  else if (cmd === 'accept') result = acceptMutationScope();
  else if (cmd === 'rollback') result = rollbackMutationScope();
  else if (cmd === 'status') {
    const reg = loadRegistry();
    result = { count: reg.count, states: (reg.pages || []).reduce((m, p) => (m[p.state] = (m[p.state] || 0) + 1, m), {}) };
  } else { usage(); process.exit(cmd ? 2 : 0); }
  console.log(JSON.stringify(result, null, 2));
  if (cmd === 'verify' && result && !result.ok) process.exit(1);
} catch (err) {
  console.error(err.stack || err.message);
  process.exit(1);
}
