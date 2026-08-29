#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   distribution_scripts/deploy_distribution.sh [--creds service-account.json --gsc-site sc-domain:example.com]
# Optional:
#   --host example.com
#   --key YOURKEY
#   --artifact-dir .build|dist
#   --allow-mixed

HOST=""
KEY="${INDEXNOW_KEY:-}"
ARTIFACT_DIR=""
GSC_CREDS=""
GSC_SITE_URL=""
ALLOW_MIXED="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --artifact-dir) ARTIFACT_DIR="${2:?}"; shift 2 ;;
    --creds) GSC_CREDS="${2:?}"; shift 2 ;;
    --gsc-site) GSC_SITE_URL="${2:?}"; shift 2 ;;
    --allow-mixed) ALLOW_MIXED="1"; shift 1 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

mkdir -p reports

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
  [[ -n "$keyfile" ]] || { echo "ERROR: could not auto-detect root key file; pass --key or set INDEXNOW_KEY" >&2; exit 1; }
  KEY="$(basename "$keyfile" .txt)"
fi

detect_host() {
  local f="$1"
  python3 - <<'PY' "$f"
import sys, urllib.parse, pathlib
hosts = set()
for raw in pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines():
    line = raw.strip().replace("<loc>", "").replace("</loc>", "").strip()
    if not line: continue
    u = urllib.parse.urlparse(line)
    if u.scheme in ("http", "https") and u.netloc: hosts.add(u.netloc)
print("\n".join(sorted(hosts)))
PY
}

if [[ -z "$HOST" ]]; then
  hosts="$(detect_host "$PRIORITY_FILE")"
  host_count="$(printf "%s\n" "$hosts" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [[ "$host_count" != "1" ]]; then
    if [[ "$ALLOW_MIXED" == "1" ]]; then
      HOST="$(printf "%s\n" "$hosts" | sed '/^$/d' | head -1)"
    else
      echo "ERROR: priority file contains multiple hosts; pass --host with split files or use --allow-mixed intentionally" >&2
      printf "%s\n" "$hosts" >&2
      exit 1
    fi
  else
    HOST="$(printf "%s\n" "$hosts" | head -1)"
  fi
fi

echo "== Distribution config =="
echo "HOST=$HOST"
echo "KEY=$KEY"
echo "ARTIFACT_DIR=$ARTIFACT_DIR"
echo "PRIORITY_FILE=$PRIORITY_FILE"
echo "BATCH_FILE=$BATCH_FILE"
echo "GSC_OPTIONAL=$([[ -n "$GSC_CREDS" && -n "$GSC_SITE_URL" ]] && echo yes || echo no)"
echo

echo "== 1) Submit IndexNow priority URLs =="
if [[ "$ALLOW_MIXED" == "1" ]]; then
  INDEXNOW_REPORT_FILE=reports/indexnow-priority-submit-report.json distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$PRIORITY_FILE" --allow-mixed
else
  INDEXNOW_REPORT_FILE=reports/indexnow-priority-submit-report.json distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$PRIORITY_FILE"
fi

echo
echo "== 2) Submit IndexNow batch URLs =="
if [[ "$ALLOW_MIXED" == "1" ]]; then
  INDEXNOW_REPORT_FILE=reports/indexnow-batch-submit-report.json distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$BATCH_FILE" --allow-mixed
else
  INDEXNOW_REPORT_FILE=reports/indexnow-batch-submit-report.json distribution_scripts/indexnow_submit.sh --host "$HOST" --key "$KEY" --file "$BATCH_FILE"
fi

python3 - <<'PY'
import json, pathlib, time
priority_path = pathlib.Path('reports/indexnow-priority-submit-report.json')
batch_path = pathlib.Path('reports/indexnow-batch-submit-report.json')
priority = json.loads(priority_path.read_text()) if priority_path.exists() else {"status":"missing"}
batch = json.loads(batch_path.read_text()) if batch_path.exists() else {"status":"missing"}
statuses = [priority.get('status'), batch.get('status')]
if any(s in {'failed','missing'} for s in statuses): status = 'partial'
elif any(s == 'dry-run' for s in statuses): status = 'dry-run'
else: status = 'success'
coverage_path = pathlib.Path(pathlib.Path('.build/indexnow-batch-coverage.json'))
if not coverage_path.exists():
    alt = pathlib.Path('dist/indexnow-batch-coverage.json')
    coverage_path = alt if alt.exists() else coverage_path
coverage = json.loads(coverage_path.read_text()) if coverage_path.exists() else {}
report = {
  "repo": "local-guides-citation-velocity",
  "submittedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
  "status": status,
  "endpoint": priority.get('endpoint') or batch.get('endpoint') or 'https://api.indexnow.org/indexnow',
  "priorityCount": priority.get('totalUrlCount', 0),
  "batchCount": batch.get('totalUrlCount', 0),
  # A count of what was submitted must never be published without the count of
  # what was not. This lane reported "count=100 status=200" and stopped there,
  # which read as "the site was submitted" when it was 100 URLs out of 2151.
  "urlPoolTotal": coverage.get('url_pool_total'),
  "deferredCount": coverage.get('deferred_urls'),
  "rotatingSlotsPerDeploy": coverage.get('rotating_slots_per_deploy'),
  "daysToFullCoverage": coverage.get('days_to_full_coverage'),
  "priority": priority,
  "batch": batch,
}
pathlib.Path('reports/indexnow-submit-report.json').write_text(json.dumps(report, indent=2)+"\n")
print('Wrote aggregate IndexNow report: reports/indexnow-submit-report.json')
if coverage:
    print(f"IndexNow coverage: {coverage.get('batch_urls')} of {coverage.get('url_pool_total')} URLs submitted this deploy; "
          f"{coverage.get('deferred_urls')} DEFERRED to a later deploy. "
          f"{coverage.get('rotating_slots_per_deploy')} rotating slot(s) close the "
          f"{coverage.get('overflow_pool')}-URL overflow pool every {coverage.get('days_to_full_coverage')} day(s).")
else:
    print('IndexNow coverage: NOT MEASURED - .build/indexnow-batch-coverage.json is absent, so how much of the site this deploy submitted is unknown.')
PY

if [[ -n "$GSC_CREDS" && -n "$GSC_SITE_URL" && -f "$GSC_CREDS" ]]; then
  echo
  echo "== 3) Submit Google sitemaps (optional) =="
  sitemaps=("https://${HOST}/sitemap.xml")
  if [[ -f "sitemap-fresh.xml" ]]; then
    sitemaps+=("https://${HOST}/sitemap-fresh.xml")
  fi
  python3 distribution_scripts/gsc_submit_sitemaps.py "$GSC_CREDS" "$GSC_SITE_URL" "${sitemaps[@]}" || echo "WARNING: GSC sitemap submission failed; IndexNow already attempted."

  echo
  echo "== 4) Inspect priority URLs in GSC API (optional) =="
  python3 distribution_scripts/gsc_inspect_urls.py "$GSC_CREDS" "$GSC_SITE_URL" "$PRIORITY_FILE" "${ARTIFACT_DIR}/inspection-results.json" || echo "WARNING: GSC inspection failed; IndexNow already attempted."
else
  echo
  echo "== 3) GSC skipped =="
  echo "GSC credentials/site not supplied. IndexNow was still attempted."
fi

echo

echo "Done."
