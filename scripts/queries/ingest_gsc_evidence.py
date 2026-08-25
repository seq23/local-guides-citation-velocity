#!/usr/bin/env python3
"""Ingest real Google Search Console query data as T1 evidence for the atlas.

Why this exists
---------------
The query atlas is evidence-gated: a query may only produce a page if it carries
demand evidence, tiered T1 (measured in GSC) > T2a > T2b (modelled) > T3. The
gate worked, but nothing ever wrote T1 evidence - the evidence file held a
handful of hand-seeded T2b rows and no process refreshed it. So the portfolio
was publishing against modelled guesses while real, measured demand sat unread
in Search Console.

This closes that loop: it reads the queries people actually typed, and writes
them as T1 evidence the atlas already knows how to consume.

Behaviour
---------
- Merges. Existing entries are never dropped, and non-T1 rows are preserved as
  they are. An earlier version of a sibling script erased 891 measured rows on
  every release when credentials were absent; this one refuses to write at all
  in that case.
- Records first_seen / last_seen so stale queries are visible rather than silently
  aging out.
- Exits 0 without writing when credentials are missing, so local runs and forks
  are not failures.

Environment
-----------
  GSC_SERVICE_ACCOUNT_JSON  service-account key, raw JSON or a path
  GSC_SITE_URL              property, e.g. sc-domain:theindustryguides.com
  GSC_EVIDENCE_PATH         default data/queries/evidence/evidence_queries.json
  GSC_LOOKBACK_DAYS         default 90
  GSC_ROW_LIMIT             default 5000
  GSC_MIN_IMPRESSIONS       default 1
"""
import datetime as dt
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / os.environ.get("GSC_EVIDENCE_PATH", "data/queries/evidence/evidence_queries.json")
LOOKBACK = int(os.environ.get("GSC_LOOKBACK_DAYS", "90"))
ROW_LIMIT = int(os.environ.get("GSC_ROW_LIMIT", "5000"))
MIN_IMPRESSIONS = int(os.environ.get("GSC_MIN_IMPRESSIONS", "1"))


def load_existing():
    try:
        return json.loads(EVIDENCE.read_text(encoding="utf-8"))
    except Exception:
        return {"schema_version": "1.0", "queries": []}


def credentials():
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON", "").strip()
    site = os.environ.get("GSC_SITE_URL", "").strip()
    if not raw or not site:
        return None, None
    if raw.startswith("{"):
        info = json.loads(raw)
    else:
        p = Path(raw)
        if not p.exists():
            return None, None
        info = json.loads(p.read_text(encoding="utf-8"))
    return info, site


def fetch(info, site):
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/webmasters.readonly"])
    svc = build("searchconsole", "v1", credentials=creds, cache_discovery=False)
    end = dt.date.today() - dt.timedelta(days=2)   # GSC data lags ~2 days
    start = end - dt.timedelta(days=LOOKBACK)
    rows, start_row = [], 0
    while True:
        resp = svc.searchanalytics().query(siteUrl=site, body={
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "dimensions": ["query"],
            "rowLimit": min(ROW_LIMIT, 25000),
            "startRow": start_row,
            "dataState": "final",
        }).execute()
        batch = resp.get("rows", [])
        rows.extend(batch)
        if len(batch) < min(ROW_LIMIT, 25000) or len(rows) >= ROW_LIMIT:
            break
        start_row += len(batch)
    return rows[:ROW_LIMIT], start, end


def main():
    info, site = credentials()
    if not info:
        print("[gsc-evidence] no credentials; leaving evidence untouched", file=sys.stderr)
        return 0

    doc = load_existing()
    existing = doc.get("queries") or []
    by_query = {str(q.get("query", "")).strip().lower(): q for q in existing if q.get("query")}

    try:
        rows, start, end = fetch(info, site)
    except Exception as exc:  # credentials present but the call failed - that is a real error
        print(f"[gsc-evidence] FAILED to read Search Console: {exc}", file=sys.stderr)
        return 1

    today = dt.date.today().isoformat()
    domain = site.replace("sc-domain:", "").replace("https://", "").replace("http://", "").rstrip("/")
    added = updated = 0
    for r in rows:
        term = (r.get("keys") or [""])[0].strip()
        impressions = int(r.get("impressions") or 0)
        if not term or impressions < MIN_IMPRESSIONS:
            continue
        key = term.lower()
        prior = by_query.get(key)
        entry = {
            "query": term,
            "evidence_tier": "T1",
            "source_type": "gsc_search_analytics",
            # `volume` is what the atlas ranks on. Impressions are this property's
            # own measured demand, not a market-wide estimate - a smaller and far
            # more honest number than a modelled volume.
            "volume": impressions,
            "impressions": impressions,
            "clicks": int(r.get("clicks") or 0),
            "ctr": round(float(r.get("ctr") or 0.0), 5),
            "average_position": round(float(r.get("position") or 0.0), 2),
            "target_domain": domain,
            "measured_window_days": LOOKBACK,
            "measured_start": start.isoformat(),
            "measured_end": end.isoformat(),
            "first_seen": (prior or {}).get("first_seen", today),
            "last_seen": today,
        }
        if prior and prior.get("evidence_tier") == "T1":
            updated += 1
        elif prior:
            # A measured query outranks a modelled one; keep the modelled fields
            # that T1 does not supply rather than discarding them.
            for k, v in prior.items():
                entry.setdefault(k, v)
            entry["evidence_tier"] = "T1"
            entry["superseded_tier"] = prior.get("evidence_tier")
            updated += 1
        else:
            added += 1
        by_query[key] = entry

    doc["schema_version"] = doc.get("schema_version", "1.0")
    doc["queries"] = sorted(by_query.values(), key=lambda q: (-int(q.get("volume") or 0), q["query"]))
    doc["last_gsc_ingest"] = {
        "at": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "site": site,
        "window": f"{start.isoformat()}..{end.isoformat()}",
        "rows_returned": len(rows),
        "added": added,
        "updated": updated,
        "total_queries": len(doc["queries"]),
    }
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    tiers = {}
    for q in doc["queries"]:
        tiers[q.get("evidence_tier")] = tiers.get(q.get("evidence_tier"), 0) + 1
    print(f"[gsc-evidence] {site}: {len(rows)} rows -> +{added} new, {updated} updated, "
          f"{len(doc['queries'])} total; tiers={tiers}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
