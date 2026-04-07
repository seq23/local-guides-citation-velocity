#!/usr/bin/env bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

node scripts/build_site.js
npm run validate:distribution

python3 - <<'PY'
import sys
from pathlib import Path
sys.path.insert(0, str(Path('distribution_scripts').resolve()))
from distribution_common import load_config
config = load_config()
if not config['indexnow'].get('key', '').strip():
    raise SystemExit('ERROR: IndexNow key missing. Run: npm run distribution:bootstrap')
print('CONFIG_OK')
PY

GSC_READY=1
python3 - <<'PY' || GSC_READY=0
import importlib.util
import sys
from pathlib import Path
sys.path.insert(0, str(Path('distribution_scripts').resolve()))
from distribution_common import load_config
config = load_config()
creds = config.get('gsc', {}).get('credentials_path', '').strip()
if not creds:
    raise SystemExit(1)
for mod in ('google.oauth2','googleapiclient.discovery'):
    if importlib.util.find_spec(mod) is None:
        raise SystemExit(1)
print('GSC_READY')
PY

if [[ "$GSC_READY" == "1" ]]; then
  python3 distribution_scripts/gsc_submit_sitemaps.py
else
  echo 'GSC_SKIP missing credentials_path or Google API python packages'
fi

bash distribution_scripts/indexnow_submit.sh

if [[ "$GSC_READY" == "1" ]]; then
  python3 distribution_scripts/gsc_inspect_urls.py
else
  echo 'INSPECTION_SKIP missing credentials_path or Google API python packages'
fi

echo
echo 'DONE'
echo 'Manual step: in Search Console, request indexing for 5-10 highest-priority URLs only.'
