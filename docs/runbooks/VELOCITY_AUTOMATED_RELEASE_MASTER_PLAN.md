# Velocity Automated Release Master Plan

## Goal

Build a hands-off citation-fix publishing system for the Local Guides Citation Velocity repo.

Target: grow toward 100,000 monthly LLM citations / surfacings by automatically absorbing Twin Agent runs and social/public backlog signals into final-condition Velocity content.

## Final Architecture

```text
Twin Agent measures citations
→ Twin Agent commits CSV/HTML/manifest into data/report_fixes/agent_runs/**
→ consolidated Velocity Content Release workflow triggers
→ repo validates intake
→ repo imports artifacts
→ repo creates normalized fix ledger
→ repo creates or upgrades content
→ repo writes atoms/tables/schema/internal links/source evidence
→ repo fills remaining batch from social/public backlog if needed
→ repo self-heals
→ repo validates
→ repo renders
→ repo commits and pushes
→ repo records release evidence
```

## One Workflow Only

The repo uses the existing consolidated workflow:

```text
.github/workflows/velocity_content_release.yml
```

No separate `agent_run_absorption.yml` workflow is used.

Triggers:

- `push` to `main` limited to `data/report_fixes/agent_runs/**`
- weekday scheduled fallback after noon Central
- manual `workflow_dispatch`

## Cadence

Twin Agent measurement: Monday–Friday, one vertical per day.

Repo automation: runs upon artifact receipt or after the scheduled fallback.

Release target:

- base: 100 publish units/week
- target: 125 publish units/week
- max: 150 publish units/week without explicit override

## Source Priority

1. Twin Agent artifacts under `data/report_fixes/agent_runs/**`
2. Social/public backlog under `data/community/publish_queue.json`
3. Existing Velocity source queues/monitor ledgers

## Quality Bar

No publish unit ships unless it has:

- direct answer
- source-backed framing
- unique route
- content atom through the existing release generator
- internal links / Find a Provider path
- safety boundary where needed
- source-to-live/staged/render trace where required
- release validation pass

## Artifact Mode Separation

Chat artifact mode remains separate.

When ChatGPT repairs repo architecture/code, it delivers a full baseline snapshot ZIP. The local updater applies that ZIP, validates, commits, and pushes. Normal Twin Agent release automation does not use the local updater.
