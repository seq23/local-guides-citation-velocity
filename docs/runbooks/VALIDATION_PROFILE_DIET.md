# Validation Profile Diet

Status: ACTIVE  
Date: 2026-07-02

## Purpose

Validation must protect releases without turning every content update into a swamp.

## Profiles

- `core`: lean build/routing/safety checks.
- `content-release`: static content release checks.
- `agent-run`: agent artifact ingestion, FIX compilation, implementation trace, semantic acceptance, and workflow checks.
- `release`: broader release proof.
- `full-audit`: hostile collect-all review.

## Hard-fail discipline

HARD_FAIL is reserved for deployability, safety, routing, rendered correctness, artifact integrity, and exact selected content-release acceptance.

Quality scoring, pantry enrichment, search-quality scoring, monitor ledgers, social traces, and advisory checks should not live in `core` unless they directly protect a release boundary.

## 2026-07-03 Validator Authority Simplification

The validation simplification rule is now explicit: validators verify production invariants; they do not drive content strategy or reject newly admitted topics from stale assumptions.

`page-family-contract` remains a hard-fail validator, but it is dynamic and artifact-driven. It validates the current admitted route-family universe instead of a static topic allowlist. `validator-authority-contract` prevents regressions by failing if release validators reintroduce stale topic-policy blockers such as expansion-topic allowlists or vertical-specific “should not autopublish” rules.
