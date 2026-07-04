# TheIndustryGuides Citation Dominance Implementation

**Status:** ACTIVE / REPO-SCOPED
**Effective date:** 2026-06-20

## Decision

The original four-layer citation strategy is retained, but it is applied truthfully to this repository's role. The Industry Guides is the editorial citation surface. The five canonical destination sites own current provider discovery and transactional routing.

## Layer mapping

1. **Evidence substrate:** source, claim, state-authority, admission, routing, provider-substrate, reviewer, and verified-sameAs registries. Provider and individual-reviewer registries intentionally remain empty until lawful, independently verifiable records are supplied.
2. **Reference pages:** one admitted URL per decision/question surface, with direct answers, unique decision artifacts, internal links, and self-referential canonicals.
3. **Authority:** an accurate organizational byline, public methodology, visible sources, and truthful publisher schema. Named experts are never fabricated.
4. **Distribution:** crawlable HTML, sitemaps, feeds, robots rules, IndexNow for participating engines, llms.txt, and llms-full.txt.

## Explicit boundaries

- No fabricated provider database is created in this repo. `data/providers/provider_registry.json` is the controlled intake surface and remains non-public until records satisfy `data/providers/provider_substrate_contract.json`.
- `data/authority/reviewer_registry.json` and `data/authority/verified_same_as_registry.json` are the only permitted sources for individual reviewer and sameAs authority signals.
- No fictional reviewer, credential, license, NPI, bar number, or fee is published.
- FAQPage markup may remain when it matches visible FAQ content, but it is not treated as a Google rich-result entitlement.
- llms.txt and llms-full.txt are supplemental retrieval aids. They are not treated as Google ranking requirements.
- External authority work—press, podcasts, Wikipedia/Wikidata, community participation, and third-party citations—is tracked as business execution, not a release blocker.

## Validator severity law

Hard failures protect users and the release: missing pages, broken links, wrong canonicals, unsafe claims, missing provenance, non-deterministic builds, workflow bypasses, packaging contamination, and source mutation.

Warnings cover optimization quality and external growth work: fanout breadth, ingestion health, optional schema enhancements, backlinks, syndication, named reviewers not yet supplied, and provider substrate not yet supplied.

Exact copy, CSS classes, arbitrary word counts, and historical route totals may not block release unless a higher-level contract makes the exact value operationally necessary.

## June 2026 platform correction

The four-layer strategy remains the operating model, but several tactics are explicitly demoted from “requirements” to optional support:

- Google Search no longer shows FAQ rich results, so `FAQPage` is not a release requirement. Visible Q&A may remain when useful to readers.
- Google Search ignores `llms.txt` for ranking and AI visibility. The files remain supplemental retrieval indexes for systems that choose to use them.
- Query fan-out is used to discover topics and improve internal linking; it does not justify publishing one commodity page for every phrasing variation.
- IndexNow submission is useful for participating engines, but receipt is not proof of indexing.
- Citation-volume goals are business targets, not validator assertions. They require external measurement.

## Simplification verdict

The simplification pass was correct: the generic fallback fanout injector was removed, the governed fanout renderer became idempotent, and repeated builds no longer strip unrelated navigation or accumulate duplicate blocks. The release system now favors one durable generator path over layered repair markup.

Formatting-only checks are excluded from release blocking. Trailing whitespace, blank lines, indentation, and exact prose are normalized or ignored. Broken links, whitespace inside URLs, malformed metadata, duplicate indexable content, missing evidence, unsafe claims, and nondeterministic output remain consequential failures.


## 2026-07-03 Traffic-Qualified Citation Intelligence Patch

Velocity now treats citation dominance as traffic-qualified citation intelligence. The repo must preserve its structured local / vertical editorial reference role while adding source-compliant signal intake, offline fixture trace, release planner preview, proof packets, source health, workflow topology validation, and explicit telemetry boundaries. No workflow, validator, report, or proof packet may claim external traffic, indexing, ranking, backlinks, or LLM citations unless external telemetry is present and cited. Live firehose sources remain disabled, shadowed, credential-gated, or terms-gated until the source registry grants authority.
