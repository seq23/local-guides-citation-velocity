# Agent Artifact Continuity Runbook — Velocity

The governed artifact lane is push/manual, not weekly scheduled. New agent runs enter through `data/report_fixes/agent_runs/YYYY-MM-DD/<vertical>/` and require manifest, CSV, HTML, and JSON for current 4-artifact runs.

Required command:

```bash
npm run release:velocity-intake
```

Required guard:

```bash
npm run validate:agent-artifact-continuity
```

Daily citation intelligence remains a read-only/shadow proof lane and may not mutate agent exact artifacts or approval queues.
