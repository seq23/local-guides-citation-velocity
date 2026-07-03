# Citation Velocity HTML FIX Runbook

Status: ACTIVE  
Date: 2026-07-02

## Purpose

Every agent HTML/PDF row is treated as an executable implementation instruction, not generic guidance.

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
