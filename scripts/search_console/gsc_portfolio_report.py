#!/usr/bin/env python3
"""Read-only Search Console report for every property the service account can see.

For each property: 28 complete days (ending 3 days ago, Search Console's data lag)
of totals, top 25 queries by impressions, and page counts / top 10 pages.
Writes one JSON per property plus summary.json into the output directory.

Exits non-zero when the account can read zero properties (Rule 0: a run that
reports nothing must not look like success).
"""
import datetime as dt
import json
import os
import re
import sys

from google.oauth2 import service_account
from googleapiclient.discovery import build


def load_service():
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON", "")
    if not raw:
        sys.exit("GSC_SERVICE_ACCOUNT_JSON is not set")
    info = json.load(open(raw)) if os.path.exists(raw) else json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False), info.get("client_email")


def query(svc, site, start, end, dims, limit):
    body = {"startDate": start, "endDate": end, "rowLimit": limit}
    if dims:
        body["dimensions"] = dims
    return svc.searchanalytics().query(siteUrl=site, body=body).execute().get("rows", [])


def row(r, key=None):
    out = {"clicks": r.get("clicks", 0), "impressions": r.get("impressions", 0),
           "ctr": round(r.get("ctr", 0), 4), "position": round(r.get("position", 0), 1)}
    if key:
        out[key] = r["keys"][0]
    return out


def main():
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "gsc-portfolio-report"
    os.makedirs(out_dir, exist_ok=True)
    svc, account = load_service()
    end = dt.date.today() - dt.timedelta(days=3)
    start = end - dt.timedelta(days=27)
    s, e = start.isoformat(), end.isoformat()
    sites = svc.sites().list().execute().get("siteEntry", [])
    summary = {"service_account": account, "start_date": s, "end_date": e,
               "property_count": len(sites), "properties": []}
    for entry in sorted(sites, key=lambda x: x["siteUrl"]):
        site = entry["siteUrl"]
        rec = {"site": site, "permission": entry.get("permissionLevel"), "start_date": s, "end_date": e}
        try:
            tot = query(svc, site, s, e, None, 1)
            rec["totals"] = row(tot[0]) if tot else {"clicks": 0, "impressions": 0, "ctr": 0, "position": 0}
            queries = query(svc, site, s, e, ["query"], 25000)
            pages = query(svc, site, s, e, ["page"], 25000)
            rec["query_count"] = len(queries)
            rec["pages_with_impressions"] = len(pages)
            rec["top_queries"] = [row(r, "query") for r in sorted(queries, key=lambda r: -r["impressions"])[:25]]
            rec["top_pages"] = [row(r, "page") for r in sorted(pages, key=lambda r: -r["impressions"])[:10]]
        except Exception as exc:  # one unreadable property must not hide the rest
            rec["error"] = str(exc)[:500]
        slug = re.sub(r"[^A-Za-z0-9]+", "_", site).strip("_")
        with open(os.path.join(out_dir, f"{slug}.json"), "w") as fh:
            json.dump(rec, fh, indent=2)
        summary["properties"].append({k: rec.get(k) for k in
            ("site", "permission", "totals", "query_count", "pages_with_impressions", "error")})
        print(f"{site}: {rec.get('totals')} queries={rec.get('query_count')} pages={rec.get('pages_with_impressions')} {rec.get('error','')}")
    with open(os.path.join(out_dir, "summary.json"), "w") as fh:
        json.dump(summary, fh, indent=2)
    if not sites:
        sys.exit("service account can read zero Search Console properties")


if __name__ == "__main__":
    main()
