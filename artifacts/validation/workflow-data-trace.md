# Workflow Data Trace

Status: **PASS**
Workflows: 6 · Manual-ready: 6 · Scheduled: 1 · Push-triggered: 2

| Workflow | Triggers | Consumes | Produces | Failure boundary |
|---|---|---|---|---|
| validate.yml | push:main<br>pull_request<br>workflow_dispatch | repository source<br>package-lock.json<br>validation registry | velocity-validated-{commit_sha}<br>validation diagnostics | No artifact is uploaded as validated unless the staged container release passes. |
| deploy-distribution.yml | workflow_run:Validate Repo<br>workflow_dispatch | velocity-validated-{commit_sha}<br>artifacts/release/validation-attestation.json<br>.build/indexnow-priority.txt<br>.build/indexnow-batch.txt | distribution evidence | The exact artifact commit SHA must match the validation attestation before distribution. |
| postdeploy_public_audit.yml | workflow_dispatch | deployed HTTPS base URL<br>_browser_suite_contract.json<br>_public_route_manifest.json | artifacts/diagnostics/click-audit/summary.json | Browser runtime is installed in-workflow and every declared route/device case must pass. |
| velocity_content_release.yml | push:agent_run_manifest<br>schedule:weekday-after-noon-ct<br>workflow_dispatch | Twin Agent ready manifests in data/report_fixes/agent_runs/**/agent_run_manifest.json<br>social/public backlog<br>Velocity source queue<br>monitor ledgers | validated commit on main<br>normalized agent run records<br>content source updates<br>rendered Velocity content<br>release diagnostics | Twin artifacts are absorbed first; social/public backlog fills the batch if artifacts are absent or insufficient. No commit or push occurs unless content generation, self-heal, agent trace, and release validation pass before commit and again after rebase. |
| release_batch.yml | workflow_dispatch | staged content<br>query clusters | validated commit on main<br>release diagnostics | The requested batch is never pushed unless the bounded self-healing release passes after mutation and rebase. |
| velocity_full_rebuild.yml | workflow_dispatch | Velocity durable source<br>monitor ledgers<br>page-family data | validated commit on main<br>rebuild diagnostics | A rebuild cannot commit or push until source repair, word-count scoring, render, and full validation pass. |
