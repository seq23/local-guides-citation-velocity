#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./deploy_distribution.sh --creds service-account.json --gsc-site "sc-domain:example.com"
# Optional overrides:
#   --host example.com
#   --key YOURKEY
#   --artifact-dir .build|dist
#   --allow-mixed

HOST=""
KEY=""
ARTIFACT_DIR=""
GSC_CREDS=""
GSC_SITE_URL=""
ALLOW_MIXED="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?}"; shift 2 ;;
    --key) KEY="${2:?}"; shift 2 ;;
    --artifact-dir) ARTIFACT_DIR="${2:?}"; shift 2 ;;
    --creds) GSC_CREDS="${2:?}"; shift 2 ;;
    --gsc-site) GSC_SITE_URL="${2:?}"; shift 2 ;;
    --allow-mixed) ALLOW_MIXED="1"; shift 1 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$GSC_CREDS" ]] || { echo "ERROR: --creds is required" >&2; exit 1; }
[[ -n "$GSC_SITE_URL" ]] || { echo "ERROR: --gsc-site is required" >&2; exit 1; }

if [[ -z "$ARTIFACT_DIR" ]]; then
  if [[ -f ".build/indexnow-priority.txt" && -f ".build/indexnow-batch.txt" ]]; then
    ARTIFACT_DIR=".build"
  elif [[ -f "dist/indexnow-priority.txt" && -f "dist/indexnow-batch.txt" ]]; then
    ARTIFACT_DIR="dist"
  else
    echo "ERROR: could not detect artifact dir (.build or dist)" >&2
    exit 1
  fi
fi

PRIORITY_FILE="${ARTIFACT_DIR}/indexnow-priority.txt"
BATCH_FILE="${ARTIFACT_DIR}/indexnow-batch.txt"

[[ -f "$PRIORITY_FILE" ]] || { echo "ERROR: missing $PRIORITY_FILE" >&2; exit 1; }
[[ -f "$BATCH_FILE" ]] || { echo "ERROR: missing $BATCH_FILE" >&2; exit 1; }

if [[ -z "$KEY" ]]; then
  keyfile="$(find . -maxdepth 1 -type f -name "*.txt" | grep -E './[0-9a-fA-F-]{32,64}\.txt$' | head -1 || true)"
  [[ -n "$keyfile" ]] || { echo "ERROR: could not auto-detect root key file; pass --key" >&2; exit 1; }
  KEY="$(basename "$keyfile" .txt)"
fi

detect_host() {
  local f="$1"
  python3 - <<'PY' "$f"
import sys, urllib.parse, pathlib
p = pathlib.Path(sys.argv[1])
hosts = set()
for raw in p.read_text(encoding="utf-8").splitlines():
    line = raw.strip().replace("<loc>", "").replace("</loc>", "").strip()
    if not line:
        continue
    u = urllib.parse.urlparse(line)
    if u.scheme in ("http","https") and u.netloc:
        hosts.add(u.netloc)
print("\n".join(sorted(hosts)))
PY
}

if [[ -z "$HOST" ]]; then
  hosts="$(detect_host "$PRIORITY_FILE")"
  host_count="$(printf "%s\n" "$hosts" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$host_count" != "1" ]]; then
    echo "ERROR: priority file contains multiple hosts; pass --host with split files or use --allow-mixed intentionally" >&2
    printf "%s\n" "$hosts" >&2
    exit 1
  fi
  HOST="$(printf "%s\n" "$hosts" | head -1)"
fi

echo "== Distribution config =="
echo "HOST=$HOST"
echo "KEY=$KEY"
echo "ARTIFACT_DIR=$ARTIFACT_DIR"
echo "PRIORITY_FILE=$PRIORITY_FILE"
echo "BATCH_FILE=$BATCH_FILE"
echo

echo "== 1) Submit Google sitemaps =="
sitemaps=("https://${HOST}/sitemap.xml")
if [[ -f "sitemap-fresh.xml" ]]; then
  sitemaps+=("https://${HOST}/sitemap-fresh.xml")
fi
python3 distribution_scripts/gsc_submit_sitemaps.py \
  "$GSC_CREDS" \
  "$GSC_SITE_URL" \
  "${sitemaps[@]}"

echo
echo "== 2) Submit IndexNow priority URLs =="
if [[ "$ALLOW_MIXED" == "1" ]]; then
  distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$PRIORITY_FILE" --allow-mixed
else
  distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$PRIORITY_FILE"
fi

echo
echo "== 3) Submit IndexNow batch URLs =="
if [[ "$ALLOW_MIXED" == "1" ]]; then
  distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$BATCH_FILE" --allow-mixed
else
  distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$BATCH_FILE"
fi

echo
echo "== 4) Inspect priority URLs in GSC API =="
python3 distribution_scripts/gsc_inspect_urls.py \
  "$GSC_CREDS" \
  "$GSC_SITE_URL" \
  "$PRIORITY_FILE" \
  "${ARTIFACT_DIR}/inspection-results.json"

echo
echo "Done."
