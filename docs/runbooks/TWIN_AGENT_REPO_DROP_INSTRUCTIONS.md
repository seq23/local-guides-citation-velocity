# Twin Agent Repo Drop Instructions

Paste these instructions into Twin Agent.

## Destination

For each vertical citation measurement run, commit the CSV and HTML email digest artifacts directly into this repo under:

```text
data/report_fixes/agent_runs/YYYY-MM-DD/<vertical>/
```

Use these vertical keys:

- `dentistry`
- `personal-injury`
- `uscis-medical`
- `neuro`
- `trt`

## Required Files

Each run folder must contain exactly these artifact types:

```text
<vertical>.csv
<vertical>.html
<vertical>.json
agent_run_manifest.json
```

Example:

```text
data/report_fixes/agent_runs/2026-06-23/dentistry/
  dentistry.csv
  dentistry.html
  dentistry.json
  agent_run_manifest.json
```

## Manifest Template

```json
{
  "source": "twin_agent",
  "run_date": "YYYY-MM-DD",
  "vertical": "dentistry",
  "csv_path": "data/report_fixes/agent_runs/YYYY-MM-DD/dentistry/dentistry.csv",
  "html_path": "data/report_fixes/agent_runs/YYYY-MM-DD/dentistry/dentistry.html",
  "json_path": "data/report_fixes/agent_runs/YYYY-MM-DD/dentistry/dentistry.json",
  "status": "READY_FOR_ABSORPTION"
}
```

## Write Boundary

Twin Agent may write only to:

```text
data/report_fixes/agent_runs/**
```

## Verify Every File Before Committing

Before the commit, re-read each of the four files from disk and check:

- `agent_run_manifest.json` and `<vertical>.json` parse with `JSON.parse` and are objects.
- `<vertical>.csv` and `<vertical>.html` are UTF-8 text, and the CSV's first line is a header row.
- None of the four files is a fetch handle, a compressed blob, or shorter than the content it is supposed to carry.

If any check fails, do not commit that folder. On 2026-09-15 all four dentistry files were committed as the same 15-byte non-UTF-8 blob; on 2026-07-20 the manifest keys arrived byte-corrupted. The repo now quarantines such a drop by name and preserves the delivered bytes at `agent_run_manifest.json.rejected`, but a quarantined run is never absorbed - the measurement is lost until it is re-delivered.

Twin Agent must commit the CSV, HTML, and manifest atomically in one commit. The Velocity workflow trigger is narrowed to the manifest path, so `agent_run_manifest.json` is the ready signal that tells the repo the full artifact package is present.

Do not commit unresolved local-fetch placeholder files such as:

```json
{"_fetchBase64":"local:/agent/current/generated/personal-injury.csv"}
```

Those are pointers, not artifacts. If a run cannot include real CSV/HTML/JSON contents, mark the manifest `QUARANTINED` with `quarantine_reason` and `quarantine_action`; the repo will preserve the folder for audit and skip absorption until real artifacts are delivered. A drop that arrives with an unparseable manifest or non-text artifacts is quarantined by the repo itself (`quarantine_reason` starting `defective_drop:`), with the delivered manifest bytes kept beside it.

Twin Agent must not edit production content, generated HTML, citation registries, page-family specs, workflow files, package files, or validation artifacts.

The repo automation will absorb the artifacts and create validated content changes.
