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
