#!/usr/bin/env bash
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"
HOST_FILTER="${1:-}"
URL_FILE_OVERRIDE="${2:-}"
python3 - <<'PY' "$HOST_FILTER" "$URL_FILE_OVERRIDE"
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path
sys.path.insert(0, str(Path('distribution_scripts').resolve()))
from distribution_common import load_config, read_urls, split_urls_by_host, chunked

host_filter = sys.argv[1].strip()
url_file_override = sys.argv[2].strip()
root = Path('.').resolve()
config = load_config()
idx = config['indexnow']
key = idx.get('key', '').strip()
key_file = idx.get('key_file', '').strip()
chunk_size = int(idx.get('chunk_size', 100))
if not key or not key_file:
    raise SystemExit('ERROR: IndexNow key not configured. Run: npm run distribution:bootstrap')
key_path = root / key_file
if not key_path.exists() or key_path.read_text(encoding='utf-8').strip() != key:
    raise SystemExit(f'ERROR: Key file missing or mismatched at repo root: {key_file}')
hosts = [h.strip() for h in idx.get('hosts', []) if h.strip()]
if host_filter:
    hosts = [h for h in hosts if h == host_filter]
    if not hosts:
        raise SystemExit(f'ERROR: Host not found in distribution.config.json: {host_filter}')
files = [url_file_override] if url_file_override else [idx['priority_file'], idx['batch_file']]
for file_path in files:
    urls = read_urls(file_path)
    grouped = split_urls_by_host(urls, hosts)
    for host in hosts:
        host_urls = grouped.get(host.lower(), grouped.get(host, []))
        if not host_urls:
            print(f'SKIP host={host} file={file_path} urls=0')
            continue
        for i, url_chunk in enumerate(chunked(host_urls, chunk_size), start=1):
            payload = {'host': host, 'key': key, 'urlList': url_chunk}
            req = urllib.request.Request(
                'https://api.indexnow.org/indexnow',
                data=json.dumps(payload).encode('utf-8'),
                headers={'Content-Type': 'application/json; charset=utf-8'},
                method='POST'
            )
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    body = resp.read().decode('utf-8', errors='replace').strip()
                    print(f'INDEXNOW_OK host={host} file={file_path} chunk={i} urls={len(url_chunk)} status={resp.status}')
                    if body:
                        print(body)
            except urllib.error.HTTPError as e:
                body = e.read().decode('utf-8', errors='replace').strip()
                print(f'INDEXNOW_FAIL host={host} file={file_path} chunk={i} urls={len(url_chunk)} status={e.code}')
                if body:
                    print(body)
                raise
PY
