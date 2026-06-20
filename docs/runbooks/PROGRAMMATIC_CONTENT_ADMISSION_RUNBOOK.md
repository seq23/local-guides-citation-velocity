# Programmatic Content Admission Runbook

Repository: `local-guides-citation-velocity-main`  
Authority: `data/content/programmatic_content_standard.json`

## Ship law

A programmatic editorial page does not enter the public release inventory unless its durable source row contains one valid, page-specific defensible data atom.

Allowed atoms:

1. Original comparison table.
2. Dated primary statistic with sample, method, and sources.
3. Named framework with at least three explicit steps.
4. Copy-paste prompt or script with at least three usable lines.
5. Decision tree with at least three condition/action branches.
6. Aggregated review synthesis with sample, date range, method, sources, and at least three findings.

## Source workflow

1. Add or update the durable row in `content/_staged/pages.json` or the registered compiler input.
2. Add the atom directly or let the compiler derive it from page-specific checklist, red-flag, and accepted monitor artifact fields.
3. Run `node scripts/apply_programmatic_content_atom_gate_2026_06_19.js` only for an intentional full source migration; normal edits should carry their own atom.
4. Run `npm run build`.
5. Run `npm run validate:generated-content-gate`.
6. Repair the source row. Do not hand-edit rendered HTML.

## Admission contract

Each admitted page must have:

- one unique atom marker;
- a direct answer of 8–70 words that names the literal page topic;
- unique `<title>`, meta description, and H1;
- absolute canonical URL;
- Article, FAQPage, HowTo, and BreadcrumbList JSON-LD;
- at least one table or ordered list;
- five to ten descriptive sibling links;
- a source-row-derived `dateModified`;
- enough substantive copy to pass the thin-page floor.

## Duplicate handling

Exact duplicate atom payloads are not converted into cosmetically renamed pages. The most specific source route is retained. Duplicates remain in durable source for history and are written to `content/_live/insight_quarantine.json` with the retained route and reason.

## Failure states

- Missing/invalid atom: build fails before publication.
- Duplicate public atom: release gate fails or the duplicate is quarantined.
- Generic answer or metadata: release gate fails.
- Missing schema, structure, or sibling links: release gate fails.
- Evidence-only monitor rows: preserved but excluded from the public route inventory.
