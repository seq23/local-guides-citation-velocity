# Citation Velocity HTML FIX Runbook

Status: ACTIVE  
Date: 2026-07-06

## Purpose

Every agent HTML/PDF row is treated as an executable implementation instruction, not generic guidance.

Agent HTML/PDF may include instruction scaffolding, editorial notes, target-page hints, or row-level FIX language. Those strings are not reader-facing content by default. The compiler must convert them into acceptance requirements and semantic evidence, then the renderer must produce clean public copy.

## Required pipeline

1. Normalize artifact rows.
2. Build exact implementation plan.
3. Compile each `FIX` / `EDIT` instruction into row-level acceptance criteria.
4. Apply the generated semantic acceptance manifest.
5. Build rendered HTML.
6. Trace agent exact implementation.
7. Validate rendered semantic acceptance.

## Commands

```bash
npm run citation:plan-agent-exact
npm run citation:compile-html-fix-acceptance
npm run citation:apply-agent-exact
npm run build
npm run trace:agent-exact
npm run validate:agent-exact-acceptance
npm run validate:agent-exact
```

## Non-negotiable law

Production semantic manifests must be generated from the source artifact rows. A hand-authored vertical-specific manifest may be used only as a temporary incident fixture or regression fixture.

Scaffold and instruction text must not be rendered as the answer. Phrases such as `Add H2`, `Use the source FIX instruction`, or framework labels belong in acceptance requirements, not public HTML. The rendered validator must hard-fail scaffold leakage.

If an agent row is ambiguous, block or preserve the source record with a reason. Do not silently drop it and do not invent a rendered repair that cannot be traced to the normalized source record.

## Blocking reasons

- `TARGET_NOT_FOUND`
- `AMBIGUOUS_TARGET_RESOLUTION`
- `OFF_VERTICAL_TOPIC`
- `UNSUPPORTED_PAGE_FAMILY`
- `MEDICAL_OR_LEGAL_RISK_REQUIRES_REVIEW`
- `SPONSORED_OR_RANKING_LANGUAGE_FORBIDDEN`
- `FIX_INSTRUCTION_AMBIGUOUS`
- `SOURCE_CONTENT_REQUIRED_BUT_MISSING`
- `ROUTE_COLLISION`
- `VALIDATION_FAILED`

## 2026-07-03 Dynamic Page-Family Contract Update

The HTML report and agent-artifact pipeline now carries route-family evidence forward as first-class admission metadata:

- `target_route`
- `renderedPath`
- `route_family`
- `route_shape`
- `route_authority`
- `admission_basis`

The release engine must use admitted routes from the approval/intake artifacts. It must not re-run topic policy after admission. The page-family validator is blocking only for structural/proof failures: missing admission evidence, malformed route shape, vertical mismatch, duplicate route, blocked row rendered, or fallback counted as exact implementation.
