#!/usr/bin/env python3
from __future__ import annotations
import sys
from pathlib import Path
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parent))
from distribution_common import load_config

def _submit(credentials_path: str, site_url: str, sitemap_url: str) -> None:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    creds = service_account.Credentials.from_service_account_file(credentials_path, scopes=['https://www.googleapis.com/auth/webmasters'])
    service = build('searchconsole', 'v1', credentials=creds, cache_discovery=False)
    service.sitemaps().submit(siteUrl=site_url, feedpath=sitemap_url).execute()
    print(f'SITEMAP_OK site={site_url} sitemap={sitemap_url}')

def main(argv: list[str]) -> int:
    if len(argv) == 4:
        _, credentials_path, site_url, sitemap_url = argv
        _submit(credentials_path, site_url, sitemap_url)
        return 0
    config = load_config()
    creds = config.get('gsc', {}).get('credentials_path', '').strip()
    if not creds:
        raise SystemExit('ERROR: gsc.credentials_path missing in distribution.config.json')
    for site in config.get('gsc', {}).get('sites', []):
        for sitemap_url in site.get('sitemaps', []):
            _submit(creds, site['site_url'], sitemap_url)
    return 0

if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
