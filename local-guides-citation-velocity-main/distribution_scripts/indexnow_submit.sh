#!/usr/bin/env bash
set -euo pipefail

# Usage:
# ./indexnow_submit.sh --host example.com --key YOURKEY --file .build/indexnow-priority.txt
# Optional:
#   --allow-mixed   split and submit per-host automatically if file contains multiple hosts

HOST=""
KEY=""
URL_FILE=""
ALLOW_MIXED="0"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) HOST="${2:?}"; shift 2 ;;
    --key) KEY="${2:?}"; shift 2 ;;
    --file) URL_FILE="${2:?}"; shift 2 ;;
    --allow-mixed) ALLOW_MIXED="1"; shift 1 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[[ -n "$URL_FILE" ]] || { echo "ERROR: --file is required" >&2; exit 1; }
[[ -f "$URL_FILE" ]] || { echo "ERROR: URL file not found: $URL_FILE" >&2; exit 1; }

if [[ -z "$KEY" ]]; then
  keyfile="$(find . -maxdepth 1 -type f -name "*.txt" | grep -E './[0-9a-fA-F-]{32,64}\.txt$' | head -1 || true)"
  [[ -n "$keyfile" ]] || { echo "ERROR: could not auto-detect root key file; pass --key" >&2; exit 1; }
  KEY="$(basename "$keyfile" .txt)"
fi

if [[ ! -f "${KEY}.txt" ]]; then
  echo "WARNING: ${KEY}.txt not found at repo root."
  echo "Expected public key URL: https://${HOST:-<detected-host>}/${KEY}.txt"
fi

tmp_clean="$(mktemp)"
python3 - <<'PY' "$URL_FILE" "$tmp_clean"
import pathlib, re, sys
src = pathlib.Path(sys.argv[1])
dst = pathlib.Path(sys.argv[2])

urls = []
for raw in src.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line:
        continue
    line = line.replace("<loc>", "").replace("</loc>", "").strip()
    if line:
        urls.append(line)

dst.write_text("\n".join(urls) + ("\n" if urls else ""), encoding="utf-8")
print(f"Prepared {len(urls)} URL lines from {src}")
PY

python3 - <<'PY' "$tmp_clean" "$HOST" "$KEY" "$ALLOW_MIXED"
import json, pathlib, re, sys, urllib.parse, urllib.request

url_file = pathlib.Path(sys.argv[1])
forced_host = sys.argv[2].strip()
key = sys.argv[3].strip()
allow_mixed = sys.argv[4] == "1"

urls = []
for line in url_file.read_text(encoding="utf-8").splitlines():
    line = line.strip()
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
    for h, hs in by_host.items():
        if h != forced_host:
            if not allow_mixed:
                raise SystemExit(f"ERROR: file contains mixed hosts ({', '.join(sorted(by_host))}); rerun with split files or --allow-mixed")
else:
    if len(by_host) > 1 and not allow_mixed:
        raise SystemExit(f"ERROR: file contains mixed hosts ({', '.join(sorted(by_host))}); rerun with split files or --allow-mixed")
    forced_host = sorted(by_host)[0]

def submit(host, host_urls):
    payload = {"host": host, "key": key, "urlList": host_urls}
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        "https://api.indexnow.org/indexnow",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        text = resp.read().decode("utf-8", errors="replace")
        print(f"IndexNow submit OK: host={host} count={len(host_urls)} status={resp.status}")
        if text.strip():
          print(text)

if allow_mixed and len(by_host) > 1:
    for host in sorted(by_host):
        submit(host, by_host[host])
else:
    submit(forced_host, urls)
PY

rm -f "$tmp_clean"
