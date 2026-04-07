#!/usr/bin/env bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
ROTATE="${INDEXNOW_ROTATE:-0}"
if [[ "${1:-}" == "--rotate" ]]; then
  ROTATE=1
fi
ROTATE="$ROTATE" python3 - <<'PY'
import os
import secrets
from pathlib import Path
import sys
sys.path.insert(0, str(Path('distribution_scripts').resolve()))
from distribution_common import load_config, write_config

root = Path('.').resolve()
config = load_config()
idx = config.setdefault('indexnow', {})
existing_key = idx.get('key', '').strip()
existing_key_file = idx.get('key_file', '').strip()
rotate = os.environ.get('ROTATE', '').strip().lower() in {'1', 'true', 'yes'}

if existing_key and existing_key_file and not rotate:
    key_path = root / existing_key_file
    if key_path.exists() and key_path.read_text(encoding='utf-8').strip() == existing_key:
        (root / 'indexnow.txt').write_text(existing_key + '\n', encoding='utf-8')
        print(f"BOOTSTRAP_NOOP key={existing_key}")
        print(f"Using committed IndexNow key file: {existing_key_file}")
        print("Rotation not requested. No new key generated.")
        print("Next steps:")
        print("1) Keep the committed key file in future baseline ZIPs.")
        print("2) Update gsc.credentials_path in distribution.config.json if you want GSC automation.")
        print("3) Run: npm run distribution:prepare")
        print("4) Run: bash distribution_scripts/deploy_distribution.sh")
        raise SystemExit(0)

key = secrets.token_hex(32).lower()
old_key_file = existing_key_file
new_key_file = f"{key}.txt"
(root / new_key_file).write_text(key + '\n', encoding='utf-8')
(root / 'indexnow.txt').write_text(key + '\n', encoding='utf-8')
idx['key'] = key
idx['key_file'] = new_key_file
write_config(config)
if rotate and old_key_file and old_key_file != new_key_file:
    old_path = root / old_key_file
    if old_path.exists():
        old_path.unlink()
print(f"BOOTSTRAP_OK key={key}")
print(f"Created committed IndexNow key file: {new_key_file}")
if rotate:
    print("Rotation requested: previous configured key file was replaced.")
print("Next steps:")
print("1) Commit and deploy the repo so the committed key file is live.")
print("2) Add your Search Console service-account JSON path to distribution.config.json if you want GSC automation.")
print("3) Run: npm run distribution:prepare")
print("4) Run: bash distribution_scripts/deploy_distribution.sh")
PY
