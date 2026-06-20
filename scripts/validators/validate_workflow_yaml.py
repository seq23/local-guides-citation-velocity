#!/usr/bin/env python3
import json
from pathlib import Path
try:
    import yaml
except Exception as exc:
    raise SystemExit(f"WORKFLOW_YAML_RUNTIME_MISSING:{exc}")
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
