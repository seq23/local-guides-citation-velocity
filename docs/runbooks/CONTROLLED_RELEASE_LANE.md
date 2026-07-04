# Controlled Release Lane

Repo: local-guides-citation-velocity

Batch D enables a low-cadence controlled citation-intelligence lane. The lane remains shadow/no-op for public content mutation in this artifact.

Command: `npm run release:controlled-citation-intelligence`

Cadence: 5 target units/day, 10 max units/day.

Runtime mutation boundary: generated signal/proof/report state only. Governance files, workflow YAML, package manifests, scripts, docs, and validation contracts are forbidden runtime mutations.

Daily scheduling: enabled at `17 13 * * *` after structural fixture trace, release planner, proof packet, workflow validators, build, and browserless fallback proof passed in container. Local updater/browser validation remains required.
