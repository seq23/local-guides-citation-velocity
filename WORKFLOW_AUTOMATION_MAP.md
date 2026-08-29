# WORKFLOW AUTOMATION MAP

| Lane | Trigger | Job | Mutation boundary |
|---|---|---|---|
| Daily citation intelligence | schedule/manual | planning/proof intelligence | no direct public-page quota publication |
| Velocity content release | agent manifest push/manual | normalize artifacts, Safe Harbor disposition, stage, exact repairs, finalize | only admitted new routes and transactionally thawed repair targets |
| Full rebuild | manual | governed self-heal/build/release proof | frozen accepted routes restored unless authorized |
| Distribution | repo scripts/manual/provider | search notification/distribution | provider credentials required where applicable |

Runtime model is FULL SAFE AUTONOMY: safe operations proceed; exceptions skip/record/continue; owner involvement is reserved for genuine external authority, credential, destructive, legal/commercial, or unrecoverable infrastructure boundaries.

## Phase 0–16 workflow additions

- `search-intelligence-loop.yml`: scheduled + manual; read/diagnose/retest/score only; no repo commit or cadence authority.
- `ci-health-recovery.yml`: workflow-run + manual; observes Validate Repo exact-SHA status and manages the automation-health issue.
- `postdeploy-public-audit.yml`: REMOVED 2026-08-29 by owner decision. The deployed click audit no longer runs in CI; the same runner still provides the local browser proof through `npm run release:prepush:local`.

Canonical workflow count: 9. Scheduled workflows: 3. Push-triggered workflows: 2. All 9 remain manual-ready.
