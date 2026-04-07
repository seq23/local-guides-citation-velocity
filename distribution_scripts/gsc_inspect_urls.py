#!/usr/bin/env python3
from __future__ import annotations
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from distribution_common import load_config, read_urls

def _inspect(credentials_path: str, site_url: str, url_file: str, output_file: str) -> None:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(credentials_path, scopes=['https://www.googleapis.com/auth/webmasters'])
    service = build('searchconsole', 'v1', credentials=creds, cache_discovery=False)
    urls = read_urls(url_file)
    out = []
    for url in urls:
        req = {'inspectionUrl': url, 'siteUrl': site_url}
        resp = service.urlInspection().index().inspect(body=req).execute()
        out.append(resp)
        print(f'INSPECT_OK {url}')
    Path(output_file).write_text(json.dumps(out, indent=2) + '\n', encoding='utf-8')
    print(f'WROTE {output_file}')

def main(argv: list[str]) -> int:
    if len(argv) == 5:
        _, credentials_path, site_url, url_file, output_file = argv
        _inspect(credentials_path, site_url, url_file, output_file)
        return 0
    config = load_config()
    creds = config.get('gsc', {}).get('credentials_path', '').strip()
    if not creds:
        raise SystemExit('ERROR: gsc.credentials_path missing in distribution.config.json')
    inspection = config.get('inspection', {})
    priority_file = inspection.get('priority_file', '.build/distribution-priority-urls.txt')
    out_dir = Path(inspection.get('output_dir', '.build/inspection-results'))
    out_dir.mkdir(parents=True, exist_ok=True)
    for site in config.get('gsc', {}).get('sites', []):
        output = out_dir / f"{site['host']}.json"
        _inspect(creds, site['site_url'], priority_file, str(output))
    return 0

if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
