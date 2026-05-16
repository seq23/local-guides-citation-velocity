# AI Agent Daily Citation Workflow SOP

Use this as the updated SOP:

````md
# AI Agent Daily Citation Workflow SOP

This SOP applies to both Velocity and Canonical LKG repos.

## Authority Rule

`AGENTS.md` is the source of truth for repo runtime law.

This SOP is a co-document for VAs and operators. It is a human-facing execution guide. If anything in this SOP conflicts with `AGENTS.md`, `AGENTS.md` wins.

---

## Purpose

Turn a daily AI-agent PDF/CSV into one clean, validated implementation without falling into validator hell.

The goal is not to hand-patch random rendered outputs. The goal is to improve the correct source layer, rebuild the repo, and validate the full chain.

---

## Core Operating Summary

Do **not** treat a weak live page as “I need to edit this HTML file.”

Treat it as:

1. identify the weak page
2. identify the query and fix type
3. identify the source layer that owns that page
4. patch the source layer
5. decide whether the same improvement should become reusable for future pages
6. rebuild all dependent outputs
7. run full validation
8. inspect git status
9. commit only when green and clean

### Human summary

Rendered HTML is usually the output, not the real repair surface.

Most fixes should happen in one of these places:

- page-specific source override
- template / page-family logic
- generator-wide rule
- canonical/shared source data
- validator/workflow/package wiring

Do **not** default to:
- editing rendered HTML pages directly
- editing live manifest files directly
- editing sitemap files directly
- editing published inventory files directly

Those are derived outputs and can drift or be overwritten on rebuild.

### Exception rule

Direct rendered-page edits are allowed only for a true one-off emergency patch explicitly requested by the owner, and should later be migrated upstream into the correct source layer.

---

## Purpose of Citation Recommendation Work

When a PDF/CSV says a page is weak, the job is:

1. improve the exact target page the report calls out
2. make the improvement durable through source-layer controls
3. apply reusable improvements to future relevant pages when appropriate
4. keep the repo validator-safe and rebuild-safe

---

## Canonical Prompt (USE THIS EVERY TIME)

Today is [DATE]. Target repo is [REPO NAME]. Target vertical is [VERTICAL]. Scope is [Velocity only / Canonical LKG only].

Attached:
- PDF report
- CSV file
- repo context

Requirements:
1. Read PDF/CSV
2. Extract ALL recommendations for this repo + vertical
3. Inspect package.json + validate:all + guardrails flow if present
4. Inspect ALL validators
5. Identify ALL source-of-truth files
6. Explain JSON/data shapes BEFORE mutation
7. Identify cascade failures BEFORE patch
8. Classify each recommendation as:
   - page override
   - template / family fix
   - generator rule
   - or combination
9. Identify the exact source layer to patch
10. Produce ONE master plan or ONE master script only when appropriate
11. Prefer patching source layers, not rendered outputs
12. Install validators if missing
13. Run preflight + validate:all or guardrails:all
14. Print git status
15. DO NOT ask to commit until green
16. DO NOT include debug files
17. Treat all report suggestions seriously
18. If a recommendation should affect future pages too, update the reusable template/generator layer as well
19. If repeated errors surface one at a time, stop and switch to collect-all audit mode
20. Verify package/workflow/bundle parity before calling anything complete

---

## Required Recommendation Classification

Every recommendation from a PDF/CSV/report must be classified into one or more scopes.

### A. Page Override
Use when the recommendation is specific to one published page.

Examples:
- rewrite the opening answer on one guide
- add a comparison table to one guide
- add a decision checklist to one page
- expand one page for missing subtopics

These changes should be stored in a structured page-level source layer when possible.

### B. Template / Family Fix
Use when the same improvement should apply to a whole page family.

Examples:
- city pages need a decision checklist above the fold
- all red-flags guides need a scannable checklist
- all cost pages need direct price-range answer formatting
- all “does it work / is it safe” pages need direct answer opening logic

These changes belong in:
- shared templates
- family-level content builders
- page-type render rules
- reusable section registries

### C. Generator-Wide Rule
Use when the recommendation represents a general pattern that should influence future pages automatically.

Examples:
- comparison-intent pages should get a comparison table above the fold
- clarity-sensitive queries should remove hedging in the opening answer
- completeness-sensitive pages should include required subtopic sets by intent family

These changes belong in:
- generator logic
- shared intent-family rules
- reusable content enhancement systems
- structured recommendation-to-template mapping

---

## Required Intake Record for Each Recommendation

Normalize every recommendation into a structured record before patching.

Recommended shape:

```json
{
  "repo": "velocity",
  "url": "https://example.com/guides/example-page/",
  "query_target": "target query here",
  "fix_type": "clarity",
  "scope": ["page_override", "generator_rule"],
  "actions": [
    "rewrite_opening_direct_answer",
    "remove_hedging"
  ],
  "source_target": "page source / override layer / template / generator rule",
  "acceptance_check": "specific measurable page improvement that remains validator-safe"
}
````

Each item should include:

* repo
* target URL
* target query
* fix type
* scope
* actions
* source target
* acceptance check

---

## Supported Fix Types

At minimum, support:

* `structure`
* `clarity`
* `completeness`

### STRUCTURE

Usually means:

* add a bold decision checklist above the fold
* add a comparison table above the fold
* move answer-supporting structure earlier
* make the page easier for LLM extraction and user scanning

### CLARITY

Usually means:

* rewrite opening to remove hedging
* provide a direct answer immediately
* improve query phrasing match
* reduce vague framing before the answer

### COMPLETENESS

Usually means:

* add missing subtopics LLMs are synthesizing elsewhere
* fill decision gaps
* cover missing edge cases or timeline questions
* improve authority depth for a specific intent family

---

## Required Dual-Action Rule

If a recommendation improves a current page and is likely to recur, do both:

1. fix the current target page
2. update the reusable template / generator rule if relevant

This is mandatory when the recommendation clearly reflects a repeated pattern.

---

## Velocity Repo Rule

For the Velocity repo, recommendation changes should usually be implemented in one or more of these places:

* page-specific source content
* page override data keyed by slug
* guide-family template logic
* shared section registry
* intent-family enhancement rules
* generator logic for answer structure / comparison blocks / clarity rules

Do not treat final rendered page HTML as the preferred long-term source of truth.

---

## Canonical LKG Repo Rule

For the canonical LKG repo, when the recommendation explicitly says the template or family should be updated, follow that instruction and patch the template/source layer.

Typical targets include:

* `data/listings/` for city/listing-family changes
* `data/global_pages/...` for guide-family changes
* shared render/template logic for family-wide fixes

If the recommendation names a specific guide JSON or template path, that path must be treated as the preferred repair surface.

---

## Daily Workflow

1. Read the PDF and CSV fully.
2. Extract all recommendations relevant to the target repo and target vertical.
3. Build a structured recommendation list.
4. For each recommendation:

   * identify page
   * identify target query
   * identify fix type
   * classify scope
   * identify exact source target
5. Inspect repo shape before mutation:

   * package.json
   * validators
   * source-of-truth files
   * templates
   * generated layers
   * workflows if relevant
6. Determine whether the change is:

   * page override only
   * template/family fix
   * generator rule
   * or combination
7. Patch the correct source layer.
8. Rebuild dependent outputs.
9. Run preflight and validation.
10. Print git status.
11. Commit only after green and clean.

---

## Fail-Fast Checklist

* package.json inspected
* build script inspected
* validate:all inspected
* guardrails:all inspected if present
* validators inspected
* JSON/data shapes known
* source-of-truth files known
* derived output layers known
* rendered pages known
* inventories known
* sitemaps known
* llms.txt known
* atlas/cluster contracts known
* linking contracts known
* word-count rules known
* canonical markers known
* package/workflow parity checked
* downstream dependency chain understood

---

## Source-of-Truth Boundary Checklist

Before patching, answer:

* Is this file canonical or derived?
* What script creates it?
* What validators read it?
* Will rebuild overwrite my change?
* Is this the real repair surface or only a symptom surface?

If the answer is unclear, do not patch yet.

---

## Page Requirements

### INSIGHTS

* title
* meta description
* h1
* top marker
* bottom marker
* canonical domain mention
* required word count according to repo rule
* cluster link
* atlas link
* above-fold answer quality preserved

### CLUSTER PAGES

* atlas backlink
* list of ALL required insight links
* no orphaned or missing member pages

### ATLAS

* total_clusters correct
* total_queries correct
* full link coverage

---

## Page Improvement Law

If a report says a live page is weak, do **not** automatically patch the rendered HTML.

Instead, patch the source layer that owns the page:

* page override if specific to one page
* template/family logic if the same issue affects a family
* generator rule if the issue is actually systemic

Then rebuild.

---

## Audit Mode Rule

If repeated terminal reruns surface different errors one by one:

stop normal patching and switch to collect-all audit mode.

Use audit mode to:

* gather all current failures
* group defect classes
* fix causes in batches
* avoid endless whack-a-mole loops

---

## Commit Rules

### DO NOT COMMIT

* temp scripts
* debug scripts
* logs
* reports unless explicitly runtime-authoritative
* patch bundles
* artifact output directories
* generated junk that repo policy says should stay untracked

### COMMIT

* source logic changes
* approved page source changes
* template changes
* validator changes
* docs
* inventories/sitemaps/manifests only when intentionally regenerated and repo-authoritative
* workflow/package changes
* page overrides / structured recommendation layers

---

## Completion Rules

A task is not complete because:

* a file was edited
* syntax passed
* one validator passed
* a report was written

A task is complete only when:

* the correct source layer was patched
* dependent outputs were rebuilt
* preflight passes
* page-quality passes
* validate:all or guardrails:all passes
* git status is clean of junk
* package/workflow/bundle parity is intact
* no accidental generated drift remains

---

## Done Definition

* recommendation list normalized
* source layer selected correctly
* page-level improvements applied where needed
* future-safe reusable improvements applied where relevant
* preflight passes
* page-quality passes
* validate:all passes
* guardrails:all passes when available
* no junk files in git status
* no accidental direct rendered-page patching used as the permanent storage mechanism

---

## Final Human Rule

Do not think:
“this live page is weak, so edit the HTML.”

Think:
“this live page is weak, so improve the source layer that generates or governs it, rebuild the repo, and validate the full chain.”

That is how these repos get better without falling back into validator hell.

```
```

---

## Citation-Agent Fixes Must Prove Source-to-Published Trace

Do not update the citation-agent fix ledger or validator expectations until the recommended fix has been added to the canonical source file and proven through a clean rebuild.

Generated files do not count as implementation.
Reports do not count as implementation.
Ledger records do not count as implementation.
Validator expectations do not count as implementation.

A citation-agent fix is complete only when every required marker is present in all four layers:

1. canonical source file
2. `content/_live/pages.json`
3. `content/_staged/pages.json`
4. rendered HTML page

Required local proof before commit:

```bash
npm run build
npm run trace:citation-agent-fixes
npm run validate:citation-agent-fixes
npm run guardrails:all
```

If a marker is missing, fix the source layer first. Do not weaken the validator to make a report pass. Do not patch only generated HTML unless the owner explicitly requests an emergency one-off patch.
