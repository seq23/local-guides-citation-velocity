# Architectural Decisions

## Velocity-only authority
The Industry Guides Velocity repository owns every editorial and programmatic page. The five canonical domains are outbound provider destinations only.

## Release lifecycle
Validation is pure. Scheduled and manual release workflows generate, build, validate, commit, push, and deploy this repository only.

## Content quality
Every generated page requires a defensible atom, direct answer, visible source provenance, multiple substantive decision sections, internal links, and Find a Provider routing. Five sections may be used by the current source set, but exact section counts are not release law.

## External actions
GSC, Bing, and disavow uploads are manual owner actions. Deployed browser proof and local Node 24 validation remain separate proof layers.

### Decision ID: ADM-2026-07-02-HTML-FIX-DETERMINISM
* **Date:** 2026-07-02
* **Status:** Accepted
* **Context:** Citation Velocity agent artifacts were able to pass with marker-level or category-level repairs even when the HTML/PDF requested exact headings, tables, scripts, checklists, and callouts.
* **Decision:** Add a generated HTML FIX acceptance compiler, page-family router, shared route resolver, semantic rendered validator, and lean validation profiles.
* **Alternatives Considered:** Continue using hand-authored vertical manifests; continue routing all new pages to community questions; add more hard-fail validators without profile discipline.
* **Reasoning:** A compiler turns each source FIX row into deterministic acceptance criteria and scales across verticals. Page-family routing prevents off-vertical or foundational content from being blindly published as community Q&A. Lean profiles reduce validation drag.
* **Tradeoffs:** The generated parser is conservative and may block ambiguous instructions that require human review.
* **Risks Accepted:** Some nuanced source instructions may require parser expansion instead of manual one-off manifests.
* **Validation Impact:** `validate:agent-run`, `validate:content-release`, `validate:core`, and `validate:release` must prove the new gates.
* **Future Reversal Conditions:** Replace the regex-based parser with a stricter structured artifact schema if incoming HTML/PDF artifacts expose machine-readable FIX blocks.

## ADR 2026-07-03 — Dynamic Page-Family Authority

Artifact admission is the source of truth for whether a citation-velocity page is allowed. The page-family router resolves route shape and metadata; the release engine obeys admitted routes; validators verify source evidence, route shape, vertical consistency, duplicate safety, blocked-row exclusion, and rendered-path determinism.

Validators must not invent topic policy. Static topic blockers, vertical scope regexes, and “new topic should not autopublish” assumptions are prohibited in release validators. New approved topics across personal injury, dentistry, TRT, neuro, USCIS medical, and future verticals are valid when admitted by the current artifact/fix universe and structurally routed.

## ADR 2026-07-06 — Agent Artifact Normalization and Snapshot Reentry

* **Status:** Accepted
* **Context:** Daily agent artifacts can arrive as CSV, HTML, JSON, and manifests with inconsistent fields, duplicate recommendations, scaffold instructions, stale paths, or partial evidence. A full baseline snapshot can also contain agent-run manifest paths that would otherwise trigger the Velocity Content Release workflow after the snapshot has already absorbed those artifacts.
* **Decision:** Treat raw agent output as untrusted input evidence. Normalize it into durable source record ledgers, disposition ledgers, implementation plans, semantic acceptance manifests, and rendered output before release. Add a workflow reentry guard so `snapshot update from baseline ZIP` push commits do not re-run `release:velocity-intake`. Scope recommendation-driven output validation to the active agent exact plan while preserving cumulative ledgers as historical authority.
* **Reasoning:** The repo must tolerate imperfect agent artifacts without letting raw artifact inconsistency corrupt downstream release, and it must not compare a small post-snapshot batch against cumulative historical recommendation evidence.
* **Validation Impact:** `validate:velocity-agent-source-coverage`, `validate:velocity-agent-duplicate-resolution`, `validate:velocity-agent-recommendation-driven-output`, `validate:velocity-intake-workflow`, `trace:agent-exact`, `validate:agent-exact`, and `trace:agent-artifact-data-flow` prove the chain.
* **Operational Rule:** Do not manually edit raw agent artifacts to make downstream checks pass. Repair normalization, disposition, route resolution, acceptance compilation, or rendered implementation instead.

## ADR 2026-07-06 — Metadata Hygiene Severity

* **Status:** Accepted
* **Context:** A duplicate meta description between an index route and a support route blocked a snapshot update even though the page, source, route, and build integrity were otherwise valid.
* **Decision:** Duplicate meta descriptions are warning or strong-warning class in the default release profile. They remain visible for SEO cleanup but do not block a safe release. Duplicate titles or H1s may still block when they indicate route or template collapse.
* **Reasoning:** Metadata hygiene matters, but it is not the same as unsafe content, broken routing, missing sources, scaffold leakage, or invalid packaging.
* **Validation Impact:** Generated content validation records duplicate meta descriptions as warnings and reserves hard failure for source, route, scaffold, rendered-file, schema, atom, and direct-answer integrity failures.
