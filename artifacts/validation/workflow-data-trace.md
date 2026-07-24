# Workflow Data Trace

Status: **PASS**
Workflows: 6 · Manual-ready: 6 · Scheduled: 1 · Push-triggered: 2

| Workflow | Lane | Triggers | Consumes | Produces | Failure boundary |
|---|---|---|---|---|---|
| daily-citation-intelligence.yml | signal-intelligence | schedule:17-13-utc<br>workflow_dispatch | traffic-qualified fixtures<br>source registry<br>strategy contract | data/signals/**<br>artifacts/validation/**<br>reports/** | Signal intelligence may update generated state but must not commit governance or source authority files. |
| validate-repo.yml | validate | push:main<br>pull_request<br>workflow_dispatch | repository source<br>package-lock.json<br>validation registry | velocity-validated-{commit_sha}<br>validation diagnostics | No artifact is uploaded as validated unless the staged container release passes. |
| velocity-content-release.yml | content-release | push:agent_run_manifest<br>workflow_dispatch | Twin Agent ready manifests<br>traffic-qualified preview proof<br>staged Velocity source | validated Velocity release commit<br>release diagnostics | Push only after Safe Harbor/transactional release finalization, deterministic rebuild, release validation, exact-agent validation, and citation-fix validation pass. |
| velocity-full-rebuild.yml | full-rebuild | workflow_dispatch | repository source<br>citation strategy gate<br>frozen accepted-output registry | validated rebuild commit<br>rebuild diagnostics | Push only after deterministic frozen-aware rebuild and release validation pass; broad self-healing is not permitted in the rebuild workflow. |
| deploy-distribution.yml | deploy | workflow_run:Validate Repo<br>workflow_dispatch | velocity-validated-{commit_sha}<br>artifacts/release/validation-attestation.json<br>.build/indexnow-priority.txt<br>.build/indexnow-batch.txt | distribution evidence | The exact artifact commit SHA must match the validation attestation before distribution. |
| postdeploy-public-audit.yml | postdeploy-audit | workflow_dispatch | deployed Velocity base URL | artifacts/diagnostics/click-audit/** | Requires real deployed URL and Playwright browser runtime; container browserless mock backup is not a substitute. |
