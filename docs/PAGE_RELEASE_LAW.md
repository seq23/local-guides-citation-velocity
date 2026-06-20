# PAGE RELEASE LAW

**Status:** LOCKED / AUTHORITATIVE  
**Version:** 1.0  
**Effective date:** 2026-06-19  
**Scope:** Every public route admitted, generated, released, rebuilt, or distributed by this repository.

## 1. Core law
A page may exist in source or staging without being public. A page may become public only when it is recorded as `ADMITTED` in `data/content/page_admission_registry.json` and every applicable clause below passes.

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

## 7. Automatic release law
Scheduled or manual automatic releases must:
1. consume only approved queue records;
2. create durable staged and live source rows;
3. attach valid primary-source records and visible source URLs;
4. pass self-healing and programmatic-substance gates;
5. rebuild the site;
6. append the route to the admission ledger, sitemap, and release history;
7. pass the same release law as every pre-existing page.

## 8. Failure law
A failed clause blocks release. The fix must be made in durable source, generator, registry, or workflow code. Rendered HTML may not be hand-edited as the primary repair.

## 9. Enforcement artifacts
- `data/release/page_release_contract.json`
- `scripts/validators/validate_page_release_law.js`
- `artifacts/validation/page-release-law.json`

