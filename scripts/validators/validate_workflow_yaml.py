#!/usr/bin/env python3
import json
from pathlib import Path
try:
    import yaml
except Exception as exc:  # noqa: BLE001
    # PyYAML was never declared as a dependency and CI only ever satisfied it by
    # accident, via the GitHub runner image's preinstalled copy. On a developer
    # machine - where the self-healing loop actually runs - the default python3
    # may not have it, and this check hard-failing blocked 35 downstream
    # validators behind it.
    #
    # Re-exec under any interpreter that does have PyYAML rather than failing on
    # a setup gap. Stays blocking if none does: a workflow-syntax check that
    # silently skips is how broken CI ships. On CI the first import succeeds and
    # none of this runs.
    import os
    import subprocess
    import sys

    if not os.environ.get("_WORKFLOW_YAML_REEXEC"):
        env = dict(os.environ, _WORKFLOW_YAML_REEXEC="1")
        seen = {sys.executable}
        for cand in ("/usr/bin/python3", "/usr/local/bin/python3",
                     "/opt/homebrew/bin/python3", "python3"):
            if cand in seen:
                continue
            seen.add(cand)
            try:
                probe = subprocess.run([cand, "-c", "import yaml"], capture_output=True)
            except OSError:
                continue
            if probe.returncode == 0:
                raise SystemExit(subprocess.run(
                    [cand, os.path.abspath(__file__), *sys.argv[1:]], env=env).returncode)

    raise SystemExit(
        f"WORKFLOW_YAML_RUNTIME_MISSING:{exc}\n"
        "  no interpreter on PATH provides PyYAML\n"
        "  remedy: python3 -m pip install -r requirements-dev.txt"
    )
ROOT=Path(__file__).resolve().parents[2]
errors=[]
files=sorted((ROOT/'.github/workflows').glob('*.yml'))
for file in files:
    try:
        data=yaml.safe_load(file.read_text())
    except Exception as exc:
        errors.append(f"{file.name}:yaml-parse:{exc}")
        continue
    if not isinstance(data,dict): errors.append(f"{file.name}:top-level-not-map")
    if 'name' not in data: errors.append(f"{file.name}:name-missing")
    # PyYAML 1.1 may parse `on` as True; accept either key while still requiring the trigger block.
    if 'on' not in data and True not in data: errors.append(f"{file.name}:on-missing")
    jobs=data.get('jobs') if isinstance(data,dict) else None
    if not isinstance(jobs,dict) or not jobs: errors.append(f"{file.name}:jobs-missing")
report={'validator':'workflow-yaml-syntax','status':'FAIL' if errors else 'PASS','workflow_count':len(files),'errors':errors}
out=ROOT/'artifacts/validation/workflow-yaml-syntax.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n')
if errors:
    print('\n'.join(errors))
    raise SystemExit(1)
print(f"WORKFLOW YAML SYNTAX PASS: {len(files)} workflows")
