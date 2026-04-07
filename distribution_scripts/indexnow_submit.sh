#!/usr/bin/env bash
set -euo pipefail

HOST="${1:?Missing host}"
KEY="${2:?Missing IndexNow key}"
URL_FILE="${3:?Missing URL file}"

if [[ ! -f "$URL_FILE" ]]; then
  echo "ERROR: URL file not found: $URL_FILE"
  exit 1
fi

TMP_JSON="$(mktemp)"
python3 - <<'PY' "$HOST" "$KEY" "$URL_FILE" "$TMP_JSON"
import json
import pathlib
import sys

host = sys.argv[1]
key = sys.argv[2]
url_file = pathlib.Path(sys.argv[3])
out = pathlib.Path(sys.argv[4])
urls = [line.strip() for line in url_file.read_text(encoding="utf-8").splitlines() if line.strip()]
out.write_text(json.dumps({"host": host, "key": key, "urlList": urls}, indent=2), encoding="utf-8")
print(f"Prepared {len(urls)} URLs")
PY

curl -sS -X POST "https://api.indexnow.org/indexnow" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @"$TMP_JSON"

echo
rm -f "$TMP_JSON"
echo "IndexNow submitted"
