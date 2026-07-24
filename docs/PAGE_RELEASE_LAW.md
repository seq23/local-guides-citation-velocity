# PAGE RELEASE LAW

**Status:** LOCKED / AUTHORITATIVE  
**Version:** 2.0  
**Effective date:** 2026-07-24  
**Scope:** Every public route admitted, generated, released, rebuilt, or distributed by this repository.

## 1. Core law
A page may exist as opportunity intelligence, proposed source, or staged source without being public. A page may become public only after it passes the machine-governed page strategy / Safe Harbor gate, is promoted through the canonical release workflow, is recorded as `ADMITTED` in `data/content/page_admission_registry.json`, and every applicable clause below passes.

The lifecycle is:

`OPPORTUNITY → ADMITTED_FOR_BUILD → STAGED → VALIDATED → LIVE → FROZEN`.

Existing accepted routes may move temporarily through `TRANSACTIONALLY_THAWED` only for an explicitly scoped repair transaction, then must return to `FROZEN` or be rolled back.

## 2. Dynamic inventory law
The public inventory is appendable. Validators must derive the current route total from the current admission ledger. No validator, workflow, release script, sitemap check, or browser contract may require equality to a historical route total. Historical totals may be retained only as minimum regression floors or immutable fixtures.


## 2A. Approved retirement and consolidation law
A historical route may leave the active inventory only when it is recorded in `data/release/route_retirements.json`, redirects permanently to an admitted target, is absent from admission and sitemaps, and preserves a documented reason. Active routes plus approved permanent retirements must meet or exceed the historical baseline. Raw count equality is forbidden.

## 2B. Non-petty validation law
Trailing whitespace, blank lines, indentation, exact marketing copy, optional schema types, and arbitrary word-count preferences may not block release. Validators may block only when the defect changes user-visible behavior, search eligibility, evidence integrity, route integrity, safety, build determinism, workflow safety, or package correctness. Whitespace embedded inside a URL remains a broken-link defect.

## 3. Required release trace
Every admitted page must identify:
- its public path;
- vertical and page type;
- source owner and source file;
- generator;
- publication status and admission basis;
- canonical domain and schema profile;
- last substantive review or modification date;
- required sources, artifacts, and content atom when those are applicable.

## 4. Rendered-page law
Every admitted route must resolve to a rendered public file and must contain:
- exactly one visible `h1`;
- exactly one canonical link whose value matches the admitted route;
- a non-empty document title and meta description;
- no unresolved template, ad, or build token;
- no duplicate public path;
- sitemap inclusion unless the route is explicitly exempted by contract.

## 5. Evidence and substance law
Pages admitted through a programmatic gate must carry the required evidence references, required artifact types, and a unique content atom. State and automatic-release pages must also pass the dedicated source-level and rendered substance validators. Route-specific wording alone is not evidence.

## 6. Safety and routing law
Every applicable editorial page must preserve visible educational boundaries, avoid rankings or guaranteed outcomes, and route provider-seeking intent only through the canonical Find a Provider destination. Sponsor, ad, and CTA surfaces may not be presented as editorial evidence.

## 7. Automatic release and Safe Harbor law
Runtime autonomy is `FULL_SAFE_AUTONOMY`. Routine owner approval is not a publication dependency.

Scheduled or manual automatic releases must:
1. consume only machine-evaluated release records from `data/release/page_release_queue.json`;
2. classify each record as safe publish, repair/link/atom work, rewrite, duplicate, unsupported, prohibited, off-topic, or external-authority-required;
3. stage new-page source first; normal builds may never promote staged source implicitly;
4. attach valid primary-source records and visible source URLs;
5. pass self-healing and source-level gates;
6. promote only `SAFE_AUTOPUBLISH` / `ADMITTED_FOR_BUILD` routes through the canonical release workflow;
7. rebuild and validate rendered output;
8. append validated live routes to the admission ledger and public inventories;
9. freeze newly accepted routes or refreeze transactionally thawed repaired routes;
10. pass the same release law as every pre-existing page.

A daily cadence is a processing budget, never a publication quota. A missing daily unit may not be replaced with a synthetic or thin page merely to hit a count. Fanout records are planning intelligence, not automatic page admissions.

## 8. Accepted-page physical freeze law
An admitted page that has passed its release validators is physically frozen accepted output. Every admitted route must have a matching record in `data/release/frozen_page_registry.json` and a content-addressed cache blob under `data/release/frozen_html_cache/`. The rendered file SHA256 must equal the accepted SHA256 recorded by the registry outside an authorized mutation transaction.

Normal builds, fanout refreshes, strategy runs, and unrelated agent runs may not change frozen bytes. A valid repair may transactionally thaw only its explicitly resolved target route(s). Failure restores the prior source snapshot and prior frozen bytes; success refreezes the new accepted bytes and records the transition.

 Later agent runs, intake batches, and generated-content workflows may not casually drop, truncate, or replace accepted semantic artifacts on that page. Any page change must be traceable to an explicit source record, ledger entry, release workflow, or unlock/refreeze action.

For agent-exact repairs, every compiled semantic acceptance requirement must render into the accepted page. A workflow may add required semantic blocks, but it may not silently omit later blocks because of page-level display caps, merge limits, or artifact truncation.

## 8A. Stage/live separation law
`content/_staged` is candidate source. `content/_live` is accepted runtime source. New-page creation writes staged source first. Promotion is explicit and validated; a normal build is forbidden from copying staged source into live merely because live is missing or empty.

## 8B. Strategy admission law
`data/strategy/page_strategy_registry.json` is the machine admission policy. `data/strategy/page_opportunity_backlog.json` is planning-only. `data/release/page_release_queue.json` records machine dispositions. Opportunity records, social signals, or query fanout entries do not become public pages until they pass distinct-intent, route, source, vertical-fit, neutrality, and duplication gates.

## 9. Failure law
A failed clause blocks release. The fix must be made in durable source, generator, registry, or workflow code. Rendered HTML may not be hand-edited as the primary repair.

## 10. Enforcement artifacts
- `data/release/page_release_contract.json`
- `data/release/frozen_page_registry.json`
- `data/strategy/page_strategy_registry.json`
- `data/release/page_release_queue.json`
- `scripts/validators/validate_page_release_law.js`
- `artifacts/validation/page-release-law.json`
