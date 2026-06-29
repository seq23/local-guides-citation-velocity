#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   distribution_scripts/indexnow_submit.sh --host example.com --key YOURKEY --file .build/indexnow-priority.txt
# Optional:
#   --allow-mixed   split and submit per-host automatically if file contains multiple hosts
# Env:
#   INDEXNOW_DRY_RUN=1
#   INDEXNOW_REPORT_FILE=reports/indexnow-priority-submit-report.json

HOST=""
KEY=""
URL_FILE=""
ALLOW_MIXED="0"
REPORT_FILE="${INDEXNOW_REPORT_FILE:-reports/indexnow-submit-report.json}"
ENDPOINT="${INDEXNOW_ENDPOINT:-https://api.indexnow.org/indexnow}"
DRY_RUN="${INDEXNOW_DRY_RUN:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?}"; shift 2 ;;
    --key) KEY="${2:-}"; shift 2 ;;
    --file) URL_FILE="${2:?}"; shift 2 ;;
    --allow-mixed) ALLOW_MIXED="1"; shift 1 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$(dirname "$REPORT_FILE")"

[[ -n "$URL_FILE" ]] || { echo "ERROR: --file is required" >&2; exit 1; }
[[ -f "$URL_FILE" ]] || { echo "ERROR: URL file not found: $URL_FILE" >&2; exit 1; }

if [[ -z "$KEY" ]]; then
  if [[ -n "${INDEXNOW_KEY:-}" ]]; then
    KEY="$INDEXNOW_KEY"
  else
    keyfile="$(find . -maxdepth 1 -type f -name "*.txt" | grep -E './[0-9a-fA-F-]{32,64}\.txt$' | head -1 || true)"
    [[ -n "$keyfile" ]] || { echo "ERROR: could not auto-detect root key file; pass --key or set INDEXNOW_KEY" >&2; exit 1; }
    KEY="$(basename "$keyfile" .txt)"
  fi
fi

python3 - <<'PY' "$URL_FILE" "$HOST" "$KEY" "$ALLOW_MIXED" "$REPORT_FILE" "$ENDPOINT" "$DRY_RUN"
import json, os, pathlib, sys, time, urllib.parse, urllib.request, urllib.error

url_file = pathlib.Path(sys.argv[1])
forced_host = sys.argv[2].strip()
key = sys.argv[3].strip()
allow_mixed = sys.argv[4] == "1"
report_file = pathlib.Path(sys.argv[5])
endpoint = sys.argv[6].strip()
dry_run = sys.argv[7].lower() in {"1", "true", "yes", "y", "on"}

urls = []
for raw in url_file.read_text(encoding="utf-8").splitlines():
    line = raw.strip().replace("<loc>", "").replace("</loc>", "").strip()
    if not line:
        continue
    p = urllib.parse.urlparse(line)
    if p.scheme not in ("http", "https") or not p.netloc:
        raise SystemExit(f"ERROR: invalid URL in file: {line}")
    urls.append(line)

if not urls:
    raise SystemExit("ERROR: no URLs found to submit")

by_host = {}
for u in urls:
    host = urllib.parse.urlparse(u).netloc
    by_host.setdefault(host, []).append(u)

if forced_host:
    if any(h != forced_host for h in by_host) and not allow_mixed:
        raise SystemExit(f"ERROR: file contains mixed hosts ({', '.join(sorted(by_host))}); rerun with split files or --allow-mixed")
else:
    if len(by_host) > 1 and not allow_mixed:
        raise SystemExit(f"ERROR: file contains mixed hosts ({', '.join(sorted(by_host))}); rerun with split files or --allow-mixed")
    forced_host = sorted(by_host)[0]

# Public key verification file is expected at root for each host. This is a warning, not a block,
# because the key file may be present on the deployed CDN even if the local artifact was cleaned.
key_file = pathlib.Path(f"{key}.txt")
key_file_present = key_file.exists()
if not key_file_present:
    print(f"WARNING: {key_file} not found at repo root; expected public key URL is https://{forced_host}/{key}.txt")

submissions = []
status = "success"
chunk_size = int(os.environ.get('INDEXNOW_CHUNK_SIZE', '100') or '100')
chunk_size = max(1, min(chunk_size, 100))

def chunks(items, n):
    for i in range(0, len(items), n):
        yield i // n + 1, items[i:i+n]

def submit(host, host_urls):
    host_records = []
    for chunk_index, url_chunk in chunks(host_urls, chunk_size):
        payload = {"host": host, "key": key, "urlList": url_chunk}
        record = {"host": host, "count": len(url_chunk), "chunk": chunk_index, "status": "pending", "httpStatus": None, "error": None}
        if dry_run:
            record["status"] = "dry-run"
            print(f"IndexNow DRY RUN: host={host} chunk={chunk_index} count={len(url_chunk)}")
            host_records.append(record)
            continue
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(endpoint, data=body, headers={"Content-Type": "application/json; charset=utf-8"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                text = resp.read().decode("utf-8", errors="replace")
                record["httpStatus"] = resp.status
                record["status"] = "success" if 200 <= resp.status < 300 else "failed"
                if text.strip():
                    record["response"] = text.strip()[:500]
                print(f"IndexNow submit {record['status']}: host={host} chunk={chunk_index} count={len(url_chunk)} status={resp.status}")
        except Exception as exc:
            record["status"] = "failed"
            record["error"] = str(exc)
            print(f"IndexNow submit failed: host={host} chunk={chunk_index} count={len(url_chunk)} error={exc}")
        host_records.append(record)
    return host_records

if allow_mixed and len(by_host) > 1:
    for host in sorted(by_host):
        submissions.extend(submit(host, by_host[host]))
else:
    submissions.extend(submit(forced_host, urls))

if any(r["status"] == "failed" for r in submissions):
    status = "partial" if any(r["status"] in {"success", "dry-run"} for r in submissions) else "failed"
elif dry_run:
    status = "dry-run"

report = {
    "repo": "local-guides-citation-velocity",
    "urlFile": str(url_file),
    "endpoint": endpoint,
    "submittedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "mode": "mixed-host" if allow_mixed else "single-host",
    "status": status,
    "dryRun": dry_run,
    "keyFilePresent": key_file_present,
    "totalUrlCount": len(urls),
    "hosts": sorted(by_host),
    "submissions": submissions,
}
report_file.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(f"Wrote IndexNow report: {report_file}")
# Warn-only for remote/network failures so deploy visibility does not block the site.
PY
