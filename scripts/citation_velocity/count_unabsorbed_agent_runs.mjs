#!/usr/bin/env node
// How many landed agent runs are still waiting to be absorbed.
//
// Prints a single integer, because query-evidence-refresh.yml reads it in a shell
// test. That lane is this repo's only permitted scheduled committer, and this count
// is the third reason it wakes the Velocity Content Release lane - the reason that
// turns a one-shot push trigger into something an artifact can survive.
//
// A run counts as unabsorbed when its manifest still says READY_FOR_ABSORPTION and
// no normalized artifact exists for it. The manifest status is the raw drop's own
// word and is never rewritten in place, so the normalized file is the real evidence
// and is what agent-artifact-continuity and agent-artifact-stranding also read.
//
// Any failure prints 0 and exits 0 on purpose: this decides whether to ADD a
// dispatch, so a crash here must not take down the evidence-refresh lane it runs
// inside. agent-artifact-stranding is the guard that notices if the dispatch is not
// happening, and it fails loudly rather than counting.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUNS = path.join(ROOT, 'data/report_fixes/agent_runs');
const NORMALIZED = 'data/report_fixes/normalized_agent_runs';

let pending = 0;
try {
  for (const date of fs.readdirSync(RUNS)) {
    const dateDir = path.join(RUNS, date);
    if (!fs.statSync(dateDir).isDirectory()) continue;
    for (const vertical of fs.readdirSync(dateDir)) {
      const manifestPath = path.join(dateDir, vertical, 'agent_run_manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { continue; }
      if (String(manifest.status || '') !== 'READY_FOR_ABSORPTION') continue;
      const absorbed = [
        `${NORMALIZED}/${date}_${String(vertical).replace(/-/g, '_')}.json`,
        `${NORMALIZED}/${date}_${vertical}.json`,
      ].some((rel) => fs.existsSync(path.join(ROOT, rel)));
      if (!absorbed) pending += 1;
    }
  }
} catch {
  pending = 0;
}
process.stdout.write(String(pending));
