# AI Agent Operating Doctrine — Defensive Repo Work

This repository must be treated as a deterministic content pipeline, not a loose collection of scripts. Agent-written changes must preserve source-of-truth boundaries, fail before writing bad output, and validate the release contract before suggesting any fix is complete.

## Mandatory workflow

1. Inspect before mutation.
   - Read the relevant files first.
   - Confirm data shape, variable names, write points, and downstream readers.
   - Prefer repo-native structure over imported patterns from another repo.

2. Never blind-patch.
   - Do not rely on brittle exact-block replacement unless the exact block has just been verified.
   - Prefer structural changes, schema-aware transforms, or anchored regex with explicit failure messages.

3. Fail before write.
   - Validate inputs and coverage before creating or overwriting generated files.
   - No script may write partial output and then discover the output is invalid.

4. Keep canonical truth separate from generated truth.
   - Canonical files live under `content/_shared`, `content/_live`, `content/_staged`, and reviewed data/config locations.
   - Generated files under `.build`, `dist`, `reports`, monitoring output, and release artifacts must not become source of truth.

5. Use defensive shell defaults.
   - Bash scripts must start with `set -euo pipefail`.
   - Node scripts must validate required files before reading and must exit non-zero on invariant failure.

6. Syntax-check before execution.
   - Run `node -c <file>` for changed Node scripts.
   - Run `bash -n <file>` for changed shell scripts.

7. One invariant per risky change.
   - Do not combine refactor, reorder, generator change, and validator change in one blind operation.
   - Make the invariant explicit and validate it.

8. Check downstream dependencies.
   - Before changing a file shape, identify who reads it.
   - Before changing execution order, identify which scripts generate reports required by later validators.

9. Dry-run or inspect mode first for risky mutation.
   - Scripts that delete, rebuild inventories, or rewrite generated maps should support inspection or write reports before mutation.

10. Validate before commit or packaging.
   - The final local authority is the repo's guardrail script, currently `npm run guardrails:all` when available, otherwise `npm run validate:all`.
   - CI must run the same full guardrail, not a partial validator subset.

## Hard prohibitions

- Do not commit nested backup ZIPs or duplicate repo copies.
- Do not commit generated reports, logs, patch bundles, or artifact output directories.
- Do not use generated clusters/scores/reports as canonical source of truth.
- Do not write a repair script that masks a generator bug while allowing the next build to recreate the same broken state.
- Do not provide a fix script before inspecting file shapes and current package scripts.

## Required pre-script due diligence

Before offering a script to fix a problem, an agent must answer:

- What generated or canonical file is failing?
- Which script creates it?
- Which validator catches it?
- Does the generator fail before write?
- Does validation run in the correct order?
- Are duplicate repo copies, nested ZIPs, generated artifacts, or stale reports being scanned?
- What exact command proves the fix?


## Velocity → LKG promotion boundary

Velocity is not a publisher. Velocity may collect non-auth public signals, normalize them, cluster them, score them, and export LKG guide candidates. It must not directly create live LKG pages, mutate LKG runtime files, or publish content.

The approved promotion flow is:

1. Velocity runs public signal ingestion from non-auth sources.
2. Velocity exports `data/lkg_candidates/YYYY-MM-DD.json` and `data/lkg_candidates/latest.json`.
3. Velocity opens a pull request against the LKG repository with the candidate payload under `data/velocity_intake/guide_candidates/`.
4. LKG validates the candidate payload, generates draft guide/page artifacts, builds, validates, and deploys preview only.
5. The user approves by merging the LKG pull request. LKG is the only repo allowed to publish.

Deprecated promotion artifacts such as `data/community/publish_queue.json` and `data/community/patch_plan.json` are not runtime authority. Any script that tries to publish queued Velocity pages directly must remain disabled or review-gated.

## Addendum — Deterministic Repo Execution, Audit Discipline, Source-of-Truth Rules, and Completion Contract

This addendum is cumulative and authoritative. It extends the existing agent rules and is intended to prevent validator hell, drift, incomplete bundles, fragile one-off patching, and confusion between canonical inputs and derived outputs.

### 1. Primary operating rule: fix causes, not reflections

The agent must prefer editing **source inputs** over **derived outputs**.

#### Source inputs (preferred targets)
These are usually valid places to make changes:
- generator/build logic
  - `scripts/build_site.js`
  - `scripts/lib/publish_contract.js`
  - generator helpers / shared libs
- validator logic
  - `scripts/validators/*.js`
- canonical/shared mapping data
  - `content/_shared/*.json`
- package/workflow/runtime wiring
  - `package.json`
  - `.github/workflows/*.yml`
- templates, renderers, shared components, canonical content registries

#### Derived outputs (do not hand-edit except emergency one-off repairs explicitly requested by owner)
These are generally **not** valid patch targets:
- rendered HTML pages
  - `insights/*.html`
  - `atlas/**/*.html`
  - generated top-level pages
- generated manifests / inventories
  - `content/_live/insights.json`
  - `content/_live/published_urls.json`
- generated indexes / exports / temp artifacts
  - `dist/*`
  - `.build/*`
  - `reports/*`
  - `data/community/*.json`
  - `data/lkg_candidates/*.json`
  - other generated caches, snapshots, monitoring outputs

**Rule:** If a file can be deterministically regenerated, do not treat it as the primary repair surface.

### 2. Never patch generated files when generator logic is the real issue

If the bug is caused by generation, mapping, publish-path logic, or manifest drift:
1. inspect source logic first
2. patch generator / canonical source layer
3. rebuild dependent layers
4. validate full chain

Do **not**:
- manually edit 20+ rendered pages to fix a generator defect
- manually edit manifest JSON to compensate for bad slug logic
- manually patch sitemap/inventory files if the generator or map is wrong

### 3. Required dependency thinking before any patch

Before writing or suggesting a patch, the agent must explicitly determine:
- What creates this file?
- What consumes this file?
- Is this file canonical or derived?
- What other layers must be rebuilt if this changes?
- Will a future build overwrite this fix?
- Is this file referenced by:
  - `package.json`
  - GitHub workflows
  - validators
  - pre-commit hooks
  - release scripts
  - updater scripts

If these dependency questions are not answered, the task is not ready for mutation.

### 4. Inspect first, mutate second

No blind patching.

For any repo change, the agent must first inspect relevant file shape using structural inspection:
- grep
- head / tail
- line-number inspection
- targeted search
- surrounding function inspection
- package/workflow references

Do not assume a line exists just because it existed in a previous bundle or container copy.

### 5. Never rely on exact-block replacement when structure may vary

Avoid fragile patch logic based on exact string blocks whenever possible.

Prefer:
- structural replacements
- targeted function-level rewrites
- guarded AST-like / regex-safe edits
- exact line verification before replacement

If exact replacement is required, the agent must verify the exact source block first in the current repo state.

### 6. Fail before write

For generated content and generated manifests, validation must happen **before** bad content is written when possible.

Required pattern:

generate candidate  
→ validate candidate/prewrite contract  
→ if fail: stop or regenerate  
→ if pass: write

Do **not** use:

write bad output  
→ validate later  
→ try to repair downstream drift

### 7. Two operating modes are required: Guardrail Mode and Audit Mode

#### Guardrail Mode
Used for routine work and CI.
- hard-fail
- deterministic
- fast
- protects structural integrity

#### Audit Mode
Used when something breaks or before major patch bundles.
- collect-all
- does not stop at first defect
- writes consolidated issue report
- groups failures by defect class
- used before broad refactors and patch deliveries

**Rule:** If repeated fail-fast iterations begin surfacing different errors one at a time, stop normal patching and switch to Audit Mode.

### 8. No “done” claim without full real-chain execution

A patch is not complete just because:
- files exist
- syntax passes
- partial validators pass
- workflows look correct
- a report was written

A repo task is only complete when the **actual runtime chain** used by the repo passes on a clean tree.

Minimum completion contract:
1. start from a clean repo state
2. apply changes
3. remove generated junk as required by repo policy
4. run the real repo chain (for this repo, `npm run guardrails:all`)
5. inspect final working tree
6. confirm no unexpected generated artifacts are staged/tracked
7. only then declare complete

### 9. Package/workflow parity is mandatory

Before shipping any patch bundle, the agent must verify that every script/workflow reference is actually present.

This includes checking:
- `package.json` scripts
- workflow `run:` commands
- validator invocations
- helper imports
- library dependencies
- pre-commit hook calls

**No patch bundle is complete unless all referenced files are included.**

This specifically means:
- if `package.json` references a validator, that validator must be in the bundle
- if a workflow references a script, that script must be in the bundle
- if a build script imports a helper, that helper must be present

### 10. Generated artifact hygiene is a hard rule

Generated artifacts must not accumulate in tracked state unless the repo explicitly treats them as runtime-authoritative.

Default rule:
- `.build/`
- `dist/`
- `reports/`
- monitoring outputs
- temporary audit outputs

must be cleaned before validation/commit unless specifically required.

The agent must respect repo-specific policy on whether generated directories are:
- ignored
- deleted before commit
- or runtime-authoritative and tracked

Never assume all generated directories should be tracked.

### 11. Special-case pages must still obey shared contracts

If the system creates special pages, exception pages, report-fix pages, or editorial/static cluster pages, they must still be evaluated against the shared publishing contract.

The agent must not create hidden “special” surfaces that bypass:
- linking rules
- hierarchy expectations
- slug policy
- publish inventory
- sitemap parity
- manifest expectations

If a truly special class exists, encode that exception deliberately in source logic and validators. Do not leave it as an undocumented edge case.

### 12. Slug, publish path, and mapping changes require full dependent rebuild

If slug rules or publish paths change, the agent must rebuild all dependent layers together.

Typical dependent layers include:
- rendered pages
- live insights manifest
- published URLs inventory
- query-to-cluster maps
- atlas registry
- sitemap
- href/link surfaces
- LLM export layers
- community/promotion indexes

Do not patch one of these in isolation when the root issue is slug generation or publish-path logic.

### 13. Validation categories: hard-fail vs audit-tier

The agent must preserve strong hard-fail validators for true integrity invariants.

Examples of valid hard-fail invariants:
- broken slug contracts
- missing mapped publish paths
- sitemap parity
- publish inventory parity
- canonical immutability
- rendered internal href breakage
- deterministic manifest drift
- executable-bit/runtime policy if required

Heuristic/editorial checks that do not break publish integrity should be:
- warning-tier
- audit-tier
- or prewrite content-quality gates, not random downstream blockers

Do not convert the validator system into an unbounded pile of overlapping fail conditions.

### 14. No repeated live terminal whack-a-mole

If more than one or two sequential terminal patches are needed to surface “the next error,” stop.

Switch to:
- audit mode
- collect-all reporting
- grouped defect-class repair
- rebuilt patch bundle

Do not continue indefinitely with:
- patch
- rerun
- new error
- patch
- rerun

That pattern is only acceptable for tiny, isolated issues. It is not acceptable for systemic repo work.

### 15. Updater compatibility is part of completion

If work is delivered as a patch/baseline bundle for an updater script, the agent must verify compatibility with the updater’s actual rules.

Examples:
- ZIP vs tarball expectations
- no report/artifact files in patch bundles if updater forbids them
- correct root structure
- correct naming pattern if enforced
- patch-mode restrictions and required env vars
- pre-commit behavior during updater auto-commit

A bundle that contains valid code but fails updater policy is **not complete**.

### 16. Commit cleanliness is part of success

After successful validation, the agent must consider:
- what is staged
- what is unstaged
- whether generated files re-dirtied the tree
- whether timestamp-only drifts should be restored
- whether `.build`, `dist`, `reports`, or monitoring files are being accidentally tracked

A task is not complete if the runtime passes but the working tree is dirty for avoidable reasons.

### 17. Velocity vs LKG repo boundary

For this repo specifically:

- **Velocity** is signal discovery, clustering, scoring, candidate generation, and PR proposal.
- **LKG** is the publishing authority and final release surface.

Velocity must not silently auto-publish into production.
Velocity may:
- generate candidates
- validate candidates
- open PRs into LKG
- maintain community/LLM support layers

LKG remains final authority for guide creation and release approval.

### 18. Approval architecture rule

The intended future flow is:

Velocity detects demand  
→ Velocity exports LKG candidate(s)  
→ PR opens into LKG  
→ owner reviews/approves in LKG  
→ LKG validates/builds/releases

The agent must preserve this separation and must not collapse it into uncontrolled automatic publishing.

### 19. Mandatory post-change checklist for the agent

Before declaring completion, the agent must be able to answer “yes” to all of these:
- Did I change source logic instead of hand-patching a derived artifact?
- Did I inspect actual file shape before patching?
- Did I verify all downstream dependents?
- Did I verify package/workflow references against actual files?
- Did I run the real end-to-end repo chain on a clean tree?
- Did I confirm generated artifact hygiene?
- Did I confirm the updater/bundle format is acceptable?
- Did I inspect the final working tree state?
- If this involved a patch bundle, did I verify the bundle is complete and self-consistent?

If any answer is “no,” the task is not complete.

### 20. Final rule: no false certainty

The agent must not claim:
- “fixed”
- “fully working”
- “ready”
- “guaranteed clean”

unless the real repo chain has been executed successfully in a clean state.

Syntax checks, file existence, and partial reports are not enough.

### 21. Execution note for this repo

For this repo, no change should be treated as complete unless the repo starts clean and the full real chain passes:

```bash
npm run guardrails:all

If repeated failures surface different problems one by one, switch to audit mode and collect all defect classes before patching further.

22. Document hierarchy rule

AGENTS.md is the authoritative runtime law for this repo.

If a separate AI SOP document exists, it must be treated as:

human-facing guidance only
optional summary only
non-authoritative if any conflict exists

If there is any conflict between documents, AGENTS.md wins.
