#!/usr/bin/env python3
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build


def main():
    if len(sys.argv) < 4:
        print("Usage: gsc_submit_sitemaps.py <creds.json> <siteUrl> <sitemap1> [sitemap2...]")
        sys.exit(1)

    creds_path = sys.argv[1]
    site_url = sys.argv[2]
    sitemap_urls = sys.argv[3:]

    scopes = ["https://www.googleapis.com/auth/webmasters"]
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
    service = build("searchconsole", "v1", credentials=creds)

    for sitemap_url in sitemap_urls:
        print(f"Submitting {sitemap_url}")
        service.sitemaps().submit(siteUrl=site_url, feedpath=sitemap_url).execute()
        print("OK")


if __name__ == "__main__":
    main()
