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
