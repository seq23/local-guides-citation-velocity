#!/usr/bin/env python3
import json
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build


def load_urls(path):
    urls = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line.startswith("http://") or line.startswith("https://"):
                urls.append(line)
    return urls


def main():
    if len(sys.argv) != 5:
        print("Usage: gsc_inspect_urls.py <creds.json> <siteUrl> <urlFile> <output.json>")
        sys.exit(1)

    creds_path = sys.argv[1]
    site_url = sys.argv[2]
    url_file = sys.argv[3]
    output_file = sys.argv[4]

    scopes = ["https://www.googleapis.com/auth/webmasters.readonly"]
    creds = service_account.Credentials.from_service_account_file(creds_path, scopes=scopes)
    service = build("searchconsole", "v1", credentials=creds)

    urls = load_urls(url_file)
    results = []
    for url in urls:
        print(f"Inspecting: {url}")
        body = {"inspectionUrl": url, "siteUrl": site_url}
        results.append(service.urlInspection().index().inspect(body=body).execute())

    with open(output_file, "w", encoding="utf-8") as handle:
        json.dump(results, handle, indent=2)
    print(f"Saved: {output_file}")


if __name__ == "__main__":
    main()
