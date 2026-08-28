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

## The two-commit sequence, and why Validate Repo goes red in between

A daily run lands on `main` as one commit carrying only the raw artifacts and a manifest already marked `READY_FOR_ABSORPTION`. The normalized artifact under `data/report_fixes/normalized_agent_runs/` that satisfies `agent-artifact-continuity` is written minutes later, by Velocity Content Release, on a second commit.

Validate Repo runs on the first commit and correctly reports `normalized_output_missing:READY_FOR_ABSORPTION:...`. That is the guard working, not a false alarm — at that commit the run really is claimed and unabsorbed. It is repaired by the absorption commit.

Because that absorption commit is pushed with `GITHUB_TOKEN`, it raises no push event and cannot re-run Validate Repo on its own. Velocity Content Release therefore dispatches Validate Repo on `main` after any commit it pushes. If that dispatched run is still red on `agent-artifact-continuity`, absorption genuinely did not happen: re-run the intake and check the Velocity Content Release logs, do not relax the guard.

Daily citation intelligence remains a read-only/shadow proof lane and may not mutate agent exact artifacts or approval queues.
