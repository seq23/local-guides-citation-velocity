# Strategy Gap-Fill + Social Fallback Contract

Status: ACTIVE CONTRACT  
Repo: local-guides-citation-velocity  
Updated: 2026-07-04

## Rule

The release strategy requires the daily release-unit floor to be hit when valid candidates exist. Agent-backed units have priority, but the system must not stop short of the target merely because the agent queue is smaller than the requested batch.

When `batch_size` / `VELOCITY_RELEASE_TARGET` is larger than the available agent-backed queue, the workflow must fill the remaining capacity with validated social/public backlog candidates.

## Social fallback definition

A social fallback unit is a public/community signal candidate admitted from the strategy gap-fill backlog when the agent-backed queue has a shortfall. It is not a loose draft and not a bypass lane. It must be:

- assigned a supported vertical;
- assigned a deterministic target route;
- tagged with `SOCIAL_BACKLOG_APPROVED_FALLBACK`;
- given source artifacts and source records;
- created into staged and live page manifests;
- rendered in the static site;
- traced by citation-agent-fix trace;
- validated by page-family, source-coverage, duplicate-resolution, rendered-programmatic, and rich-new-page contracts.

## Priority order

```text
1. Agent-backed repairs / new-page units
2. Validated social fallback units needed to fill the selected release target
3. Nothing else
```

## Failure policy

If social fallback cannot be created or traced, the run should fail. The correct repair is to fix materialization, route authority, source tagging, or validation. The correct repair is not to suppress fallback by default.

## Operator interpretation

For `batch_size=150`:

```text
76 agent-backed units + 74 validated social fallback units = 150 release units
```

That means all 150 selected units must either publish or fail with a specific repairable reason.
