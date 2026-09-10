# VALIDATION AND HANDOFF

## Proof boundary

Assistant-side default proof for this artifact is structural/package integrity only. Full runtime validation is performed locally by the repo updater/validation workflow after applying the ZIP.

## Structural checks before delivery

- ZIP archive opens and has exactly one repo root.
- Required updater files and `dist/` are present.
- Release-critical files inside the reopened ZIP match the artifact manifest size and SHA256.
- 100K shard index and every shard parse, hash, count, ID range, and aggregate count are valid.
- Old monolithic 100K file is absent.
- Every admitted route has a frozen record/cache blob and rendered HTML hash matching the accepted hash.
- Internal data/docs/cache do not leak into `dist/`.

## Local validation after applying

Use the updater for this generic/Velocity repo. The updater is responsible for install/build/full validation/commit/push behavior under the local workflow. A freshly generated local release result—not the historical PASS:88 receipt—is the authority for the updated repo.

Recommended repo checks include `npm run validate:release`, page-release law, determinism, tree/shard hygiene, agent-run integrity, rendered content gates, and local/browser proof where the environment supports it.

## Success boundary

Do not call the repo fully validated merely because the ZIP is structurally correct. Final artifact status remains **STRUCTURALLY CHECKED — LOCAL VALIDATION REQUIRED** until local validation passes.

## Deep Phase 0–16 validation additions

When deep validation is explicitly requested, run `npm run deep:phase-0-16` plus the native build, Agent exact semantic acceptance, rendered href/src integrity, deterministic rebuild, search quality, content safety, workflow YAML/data trace, and final package extraction checks.

Search Intelligence proof must include: 240 owned targets, 106 read-only Agent signals, zero unowned targets, truthful provider states, candidate/mutation receipts, 14-day retest/cooldown semantics, verified-citation evidence rules, the 15-case validator materiality hostile pack, the 9-case Search Intelligence hostile pack, and protected-Agent byte identity.

Real deployed Playwright, exact-pushed-SHA GitHub CI, and live GSC/Bing/provider observations must remain explicitly unproven until they actually run.

## Open work handed over on 2026-09-10

Named here rather than left in a chat log. Each item says what it is, what was
tried, exactly what stopped it, and what would unblock it.

### 1. BLOCKING THE DRAIN — 39 recommendations regress on 13 TRT pages during the build

`agent-recommendation-page-application` refuses to rebaseline inside the release:

    REBASELINE REFUSED: 39 recommendation(s) this baseline recorded as APPLIED are
    no longer shown by their page. Enrolling them would bank a regression and
    retire content that had already landed. Put the content back on the page.

13 pages, 3 each, all under `trt/community-questions/*` and `trt/guides/*`.

- **This is a real content defect, not a guard that cannot clear itself.** The
  refusal is correct and must not be rebaselined away.
- **It is build-induced.** On `main` the same validator PASSES with "nothing that
  had landed has regressed", and at least one named page
  (`trt/community-questions/best-trt-clinic-near-me/index.html`) does not exist on
  `main` at all.
- **Tried:** re-running the registered repair (it refuses, correctly).
- **Stopped by:** needing a build reproduction and a per-page diff to find what the
  build drops. Not attempted.
- **Unblocks by:** thaw those 13 routes, `npm run build`, diff each page against its
  committed copy, and fix the generator or the accepted-artifact merge that drops
  the blocks. The method is the one used on `uscis-medical/index.html` in PR #110.
- **It fires in the ABSORPTION step**, which is before the publish gate, so per-unit
  isolation (PR #111) does not route around it.

### 2. Template scaffolding is published on 113 of 366 rendered pages (31%)

Counted across the rendered tree:

    68  "Concrete verification point <n>"          - a placeholder shipped as content
    111 "...into a specific verification question" - instruction text as a table cell
    63  "Comparison method"                        - byte-identical duplicate rows

`personal-injury/cost-fees`'s own agent report independently flags the same class,
naming `"with a structured lead:"` as a visible H2. Separate work, and hers to scope.

### 3. Three content decisions — DECIDED 2026-09-10

All three are settled and guarded by `uscis-authority-grounding-coverage`
(Tier 1, HARD_FAIL). Nothing here is an open item.

**The count was 22, not 35.** Re-deriving the backlog — every route
`resolveTargetPath()` maps a fix-ledger row or a normalized agent run onto, where
the resolved path is under `uscis-medical/` — gives 29 routes, 7 of which were
already grounded. The "35" was a stale figure; 22 routes were genuinely
ungrounded. **21 of 29 are now grounded, 8 remain named stops.**

- **14 `uscis-medical/` routes grounded INDIVIDUALLY**, each written to its own
  question against the USCIS/CDC primary sources that answer that question, with
  its own artifact types and tables. The spray-one-template repair is now not
  merely discouraged but *measured against*: the validator compares every pair of
  grounded uscis entries on `required_strings` and answer text and fails if any two
  converge.
- **8 routes stay named stops**, with reasons in
  `data/report_fixes/uscis_authority_grounding_register.json`. Seven have a slug
  that is a slugified, truncated URL — the agent row's "query" is literally
  `https://theindustryguides.com/insights/uscis-medical-0NN-….html`, and in all
  seven cases that insights page already exists. The eighth leaked a provider label
  (`…-perplexity`) into the slug and duplicates a route this work grounds. For all
  eight the correct repair is route canonicalization, not content: grounding them
  would publish a second copy of an existing canonical page.
- `insights/personal-injury-025` — **decided: the "Direct answer" block EXISTS and
  is authoritative, under a query-matched heading rather than the literal label.**
  The REPLACE rows object to the block's *content* being about hit-and-run medical
  bills rather than the uninsured-driver query, not to the block existing; the ADD
  rows object to there being no extractable summary, not to the label. Read at
  phrase level they agree, and that is the `neuro-008` precedent applied unchanged
  (`cleanCarried()`: removal wins on the phrase, content survives retitled).
- `personal-injury/cost-fees` — **decided: retire the promise.** Neither
  `"with a structured lead:"` nor `"Step 2 — Add a"` was ever content anyone asked
  for; both are FIX/EDIT instruction prose the parser promoted into titles and
  `required_strings`. The repo's own `phrasesTheFixAsksToRemove()` already
  classifies the first as a removal target, so the parser agrees it is a defect.
  Re-deriving the same contradiction found it on four MORE routes — two dentistry
  pages were promising to publish *"Use the same questions with every lawyer on
  your shortlist"* — and those are fixed under the same precedent.

Reasoning for each is recorded in `data/report_fixes/landed_directive_decisions.json`
so the contradictions cannot be re-litigated. Only durable ledger promises were
changed; no rendered page was touched.

### 4. Per-unit isolation is wired at the PUBLISH gate only

`scripts/release/hold_failing_units.mjs` (PR #111) charges a blocking-validator
failure to the unit that caused it. Two validators are mapped so far, from measured
evidence shapes: `rendered-output-shrink-guard` and
`agent-recommendation-page-application`. Every other blocking validator is SYSTEMIC
by default and fails the whole run — today's behaviour exactly.

To extend it: measure the validator's evidence shape, add `unit_attribution` to its
registry entry, and `release-isolation-contract` will prove the pointer resolves.
Never guess a mapping — a wrong one holds units that were never at fault.
