#!/usr/bin/env python3
"""Search Console portfolio tooling for every property the service account can see.

Usage: gsc_portfolio_report.py [--mode report|sitemaps|coverage|analytics] [out_dir]
       gsc_portfolio_report.py --mode daily --site sc-domain:theindustryguides.com [data_dir]

report   (default) 28 complete days (ending 3 days ago, Search Console's data lag)
         of totals, top 25 queries by impressions, and page counts / top 10 pages.
sitemaps sitemaps.list per property; discovers the live sitemaps (robots.txt
         Sitemap: lines, else /sitemap.xml, following sitemap-index children),
         sitemaps.delete every submitted sitemap the site no longer serves (a
         retired sitemap reports its own 404 as an error for ever), and
         sitemaps.submit every one that is not listed or whose last submission
         errored; re-lists and records before/after state. Writes to Search
         Console only; never to the repo.
coverage urlInspection.index.inspect on sitemap URLs (homepage first, then sitemap
         order, cap 150 per property) under a portfolio-wide daily budget,
         8 requests in parallel; counts by coverage bucket plus per-URL rows.

analytics query+page rows (rolling 28 complete days) for every property, one JSON
         each; the portfolio-wide read the per-site daily files are built from.
daily    ONE property, committed by the daily cycle into data_dir
         (default data/search_intelligence): gsc_search_analytics_export.json
         (query+page, rolling 28 days), gsc_sitemaps.json (sitemaps.list; submit
         only when the property lists none) and index_coverage.json (URL
         Inspection, 8 in parallel, at most 150 URLs a day, never-inspected and
         oldest-inspected URLs first, so the rotation covers the whole sitemap
         over time; rows merge with the previous file). A missing credential or
         an unreadable property is a NAMED STOP line, exit 0, files untouched.

Every other mode writes one JSON per property plus summary.json into out_dir and
prints the summary. Exits non-zero when the account can read zero properties,
or when a mode found nothing to act on (Rule 0: a run that reports nothing must
not look like success).
"""
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import sys
import threading
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

from google.oauth2 import service_account
from googleapiclient.discovery import build


READONLY = "https://www.googleapis.com/auth/webmasters.readonly"
WRITE = "https://www.googleapis.com/auth/webmasters"  # sitemaps.submit only
INSPECT_CAP_PER_PROPERTY = 150
INSPECT_DAILY_BUDGET = int(os.environ.get("GSC_INSPECT_DAILY_BUDGET", "2000"))
INSPECT_PARALLEL = 8


def load_creds(scope=READONLY):
    raw = os.environ.get("GSC_SERVICE_ACCOUNT_JSON", "")
    if not raw:
        sys.exit("GSC_SERVICE_ACCOUNT_JSON is not set")
    info = json.load(open(raw)) if os.path.exists(raw) else json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(info, scopes=[scope])
    return creds, info.get("client_email")


def make_service(creds):
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


def load_service(scope=READONLY):
    creds, account = load_creds(scope)
    return make_service(creds), account


def slug(site):
    return re.sub(r"[^A-Za-z0-9]+", "_", site).strip("_")


def write_json(out_dir, name, obj):
    with open(os.path.join(out_dir, name), "w") as fh:
        json.dump(obj, fh, indent=2)


def list_sites(svc):
    return sorted(svc.sites().list().execute().get("siteEntry", []), key=lambda x: x["siteUrl"])


def site_root(site):
    """sc-domain:example.com -> https://example.com/ ; URL-prefix properties stay as-is."""
    if site.startswith("sc-domain:"):
        return "https://" + site.split(":", 1)[1] + "/"
    return site if site.endswith("/") else site + "/"


def in_property(site, url):
    """True when url belongs to the property: same domain or a subdomain for
    sc-domain:, same prefix for URL-prefix properties. Search Console rejects
    any other URL with 'not part of this property', so those are never sent."""
    if site.startswith("sc-domain:"):
        domain = site.split(":", 1)[1].lower()
        host = urllib.parse.urlsplit(url).hostname or ""
        return host == domain or host.endswith("." + domain)
    return url.startswith(site_root(site))


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; gsc-portfolio-report)"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.geturl(), resp.status, resp.read()


def local(tag):
    return tag.rsplit("}", 1)[-1]


def discover_sitemaps(site):
    """Return (sitemap_urls_in_order, page_urls_in_order, notes) from the live host."""
    root = site_root(site)
    notes, declared = [], []
    try:
        final, _, body = fetch(root + "robots.txt")
        notes.append(f"robots.txt fetched from {final}")
        for line in body.decode("utf-8", "replace").splitlines():
            m = re.match(r"\s*sitemap\s*:\s*(\S+)", line, re.I)
            if m and m.group(1) not in declared:
                declared.append(m.group(1))
    except Exception as exc:
        notes.append(f"robots.txt unreadable: {str(exc)[:200]}")
    if not declared:
        declared = [root + "sitemap.xml"]
        notes.append("no Sitemap: line in robots.txt; trying /sitemap.xml")
    sitemaps, pages, queue, seen = [], [], list(declared), set()
    while queue and len(seen) < 200:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            _, _, body = fetch(url)
            tree = ET.fromstring(body)
        except Exception as exc:
            notes.append(f"sitemap unreadable {url}: {str(exc)[:200]}")
            continue
        sitemaps.append(url)
        kind = local(tree.tag)
        for node in tree:
            loc = next((c.text.strip() for c in node if local(c.tag) == "loc" and c.text), None)
            if not loc:
                continue
            if kind == "sitemapindex":
                queue.append(loc)
            elif loc not in pages:
                pages.append(loc)
    return sitemaps, pages, notes


def sitemap_state(entries):
    out = {}
    for e in entries:
        out[e["path"]] = {"lastSubmitted": e.get("lastSubmitted"), "lastDownloaded": e.get("lastDownloaded"),
                          "isPending": e.get("isPending"), "isSitemapsIndex": e.get("isSitemapsIndex"),
                          "errors": int(e.get("errors", 0) or 0), "warnings": int(e.get("warnings", 0) or 0),
                          "submitted_urls": sum(int(c.get("submitted", 0) or 0) for c in e.get("contents", []))}
    return out


def run_sitemaps(out_dir):
    svc, account = load_service(WRITE)
    sites = list_sites(svc)
    summary = {"mode": "sitemaps", "service_account": account, "property_count": len(sites),
               "run_date": dt.date.today().isoformat(), "properties": []}
    discovered_total = 0
    for entry in sites:
        site = entry["siteUrl"]
        rec = {"site": site, "permission": entry.get("permissionLevel")}
        try:
            before = sitemap_state(svc.sitemaps().list(siteUrl=site).execute().get("sitemap", []))
            found, pages, notes = discover_sitemaps(site)
            discovered_total += len(found)
            rec.update({"listed_before": sorted(before), "discovered": found, "discovery_notes": notes,
                        "sitemap_page_urls": len(pages)})
            submitted, submit_errors = [], {}
            retired, retire_errors = [], {}
            foreign = [u for u in found if not in_property(site, u)]
            for url in found:
                prior = before.get(url)
                if url in foreign:
                    continue  # another property's sitemap (redirected host); submitting it returns 400
                if prior is None or prior["errors"] > 0:
                    try:
                        svc.sitemaps().submit(siteUrl=site, feedpath=url).execute()
                        submitted.append(url)
                    except Exception as exc:
                        submit_errors[url] = str(exc)[:300]
            # A sitemap the site no longer publishes stays submitted for ever and
            # counts its own 404 as an error. theindustryguides.com retired
            # sitemap_util.xml and sitemap_all.xml (#217 replaced them with
            # sitemap_pages.xml); sitemap_util.xml kept a 7 Apr 2026 submission,
            # answered 404 from then on, and reported "1 errors" to every
            # Search Readiness run. The loop above made it worse: errors > 0 meant
            # it was re-submitted on every pass, so the error could never clear.
            #
            # Retire it instead, and only when the URL is genuinely gone: it is
            # absent from the live sitemap set AND does not answer 200. A sitemap
            # that is merely missing from robots.txt is left alone.
            for url in sorted(set(before) - set(found)):
                if url in foreign or not in_property(site, url):
                    continue
                try:
                    # fetch() returns (final_url, status, body) and raises for a 404.
                    _, status, body = fetch(url)
                    head = body[:2000]
                    still_served = status == 200 and (b"<urlset" in head or b"<sitemapindex" in head)
                except Exception:
                    still_served = False
                if still_served:
                    continue
                try:
                    svc.sitemaps().delete(siteUrl=site, feedpath=url).execute()
                    retired.append(url)
                except Exception as exc:
                    retire_errors[url] = str(exc)[:300]
            after = sitemap_state(svc.sitemaps().list(siteUrl=site).execute().get("sitemap", []))
            rows = []
            for url in sorted(set(found) | set(before) | set(after)):
                a = after.get(url, {})
                rows.append({"sitemap": url, "was_listed": url in before, "live": url in found,
                             "foreign_host": url in foreign,
                             "submitted_now": url in submitted, "submit_error": submit_errors.get(url),
                             "before": before.get(url), "lastSubmitted": a.get("lastSubmitted"),
                             "errors": a.get("errors"), "warnings": a.get("warnings"),
                             "isPending": a.get("isPending"), "listed_after": url in after})
            rec.update({"rows": rows, "listed_after": sorted(after), "submitted_count": len(submitted),
                        "foreign_sitemaps": foreign,
                        "retired": retired, "retired_count": len(retired),
                        "retire_errors": retire_errors, "retire_error_count": len(retire_errors),
                        "submit_error_count": len(submit_errors)})
        except Exception as exc:
            rec["error"] = str(exc)[:500]
        write_json(out_dir, f"{slug(site)}.json", rec)
        summary["properties"].append({k: rec.get(k) for k in (
            "site", "permission", "listed_before", "discovered", "foreign_sitemaps", "sitemap_page_urls", "submitted_count",
            "submit_error_count", "retired", "retired_count", "retire_error_count", "listed_after", "rows", "discovery_notes", "error")})
        print(f"{site}: before={len(rec.get('listed_before') or [])} live={len(rec.get('discovered') or [])} "
              f"submitted={rec.get('submitted_count')} retired={rec.get('retired_count')} "
              f"after={len(rec.get('listed_after') or [])} {rec.get('error','')}")
    summary["no_sitemap_before"] = [p["site"] for p in summary["properties"] if not p.get("listed_before")]
    summary["sitemaps_submitted"] = sum(p.get("submitted_count") or 0 for p in summary["properties"])
    summary["sitemaps_retired"] = sum(p.get("retired_count") or 0 for p in summary["properties"])
    write_json(out_dir, "summary.json", summary)
    print(json.dumps(summary, indent=1))
    if not sites:
        sys.exit("service account can read zero Search Console properties")
    if discovered_total == 0:
        sys.exit("no live sitemap found on any property")


def bucket(result):
    idx = result.get("indexStatusResult", {})
    state = (idx.get("coverageState") or "").lower()
    if "unknown to google" in state:
        return "unknown"
    if "crawled" in state and "not indexed" in state:
        return "crawled_not_indexed"
    if "discovered" in state and "not indexed" in state:
        return "discovered_not_indexed"
    if idx.get("verdict") == "PASS" or ("indexed" in state and "not indexed" not in state):
        return "indexed"
    return "other"


def allocate(wants, budget):
    """Water-fill a daily budget across properties; returns {site: allowance}."""
    alloc = {s: 0 for s in wants}
    left, open_sites = budget, [s for s in wants if wants[s] > 0]
    while left > 0 and open_sites:
        share = max(1, left // len(open_sites))
        for s in list(open_sites):
            give = min(share, wants[s] - alloc[s], left)
            alloc[s] += give
            left -= give
            if alloc[s] >= wants[s]:
                open_sites.remove(s)
            if left <= 0:
                break
    return alloc


def run_coverage(out_dir):
    creds, account = load_creds(READONLY)
    svc = make_service(creds)
    sites = list_sites(svc)
    plans, notes = {}, {}
    for entry in sites:
        site = entry["siteUrl"]
        _, pages, n = discover_sitemaps(site)
        home = site_root(site)
        own = [u for u in pages if in_property(site, u)]
        ordered = [home] + [u for u in own if u.rstrip("/") != home.rstrip("/")]
        plans[site] = ordered
        notes[site] = n + [f"{len(pages)} URLs in live sitemaps, {len(own)} inside this property"
                           + (f"; {len(pages) - len(own)} on another host skipped" if len(own) < len(pages) else "")]
    wants = {s: min(len(u), INSPECT_CAP_PER_PROPERTY) for s, u in plans.items()}
    alloc = allocate(wants, INSPECT_DAILY_BUDGET)
    local_svc = threading.local()

    def inspect(site, url):
        if not hasattr(local_svc, "svc"):
            local_svc.svc = make_service(creds)
        try:
            res = local_svc.svc.urlInspection().index().inspect(
                body={"inspectionUrl": url, "siteUrl": site}).execute().get("inspectionResult", {})
            idx = res.get("indexStatusResult", {})
            return {"url": url, "bucket": bucket(res), "verdict": idx.get("verdict"),
                    "coverageState": idx.get("coverageState"), "lastCrawlTime": idx.get("lastCrawlTime"),
                    "googleCanonical": idx.get("googleCanonical"), "userCanonical": idx.get("userCanonical"),
                    "robotsTxtState": idx.get("robotsTxtState"), "indexingState": idx.get("indexingState"),
                    "pageFetchState": idx.get("pageFetchState"), "referringUrls": idx.get("referringUrls")}
        except Exception as exc:
            return {"url": url, "bucket": "error", "error": str(exc)[:300]}

    jobs = [(s, u) for s in plans for u in plans[s][:alloc[s]]]
    rows = {s: [] for s in plans}
    with cf.ThreadPoolExecutor(INSPECT_PARALLEL) as pool:
        futs = {pool.submit(inspect, s, u): s for s, u in jobs}
        for f in cf.as_completed(futs):
            rows[futs[f]].append(f.result())
    keys = ["indexed", "crawled_not_indexed", "discovered_not_indexed", "unknown", "other", "error"]
    summary = {"mode": "coverage", "service_account": account, "property_count": len(sites),
               "run_date": dt.date.today().isoformat(), "daily_budget": INSPECT_DAILY_BUDGET,
               "cap_per_property": INSPECT_CAP_PER_PROPERTY, "inspected_total": len(jobs),
               "truncated": [], "totals": {k: 0 for k in keys}, "properties": []}
    for site in plans:
        order = {u: i for i, u in enumerate(plans[site])}
        r = sorted(rows[site], key=lambda x: order.get(x["url"], 0))
        counts = {k: sum(1 for x in r if x["bucket"] == k) for k in keys}
        states = {}
        for x in r:
            states[x.get("coverageState") or x["bucket"]] = states.get(x.get("coverageState") or x["bucket"], 0) + 1
        truncated = alloc[site] < len(plans[site])
        rec = {"site": site, "sitemap_urls_in_property": len(plans[site]) - 1, "inspected": len(r), "allowance": alloc[site],
               "truncated": truncated, "truncated_by": ("cap" if alloc[site] == INSPECT_CAP_PER_PROPERTY else "budget") if truncated else None,
               "counts": counts, "coverage_states": states, "notes": notes[site], "rows": r}
        if truncated:
            summary["truncated"].append({"site": site, "available": len(plans[site]), "inspected": alloc[site],
                                         "by": rec["truncated_by"]})
        for k in keys:
            summary["totals"][k] += counts[k]
        write_json(out_dir, f"{slug(site)}.json", rec)
        summary["properties"].append({k: rec[k] for k in ("site", "sitemap_urls_in_property", "inspected", "allowance",
                                                          "truncated", "truncated_by", "counts", "coverage_states", "notes")})
        print(f"{site}: inspected={len(r)} {counts}")
    write_json(out_dir, "summary.json", summary)
    print(json.dumps(summary, indent=1))
    if not sites:
        sys.exit("service account can read zero Search Console properties")
    if len(jobs) == summary["totals"]["error"]:
        sys.exit("no URL inspection succeeded")


def window():
    end = dt.date.today() - dt.timedelta(days=3)
    start = end - dt.timedelta(days=27)
    return start.isoformat(), end.isoformat()


def collect_analytics(svc, site):
    """query+page rows for the rolling 28-day window, with per-query and per-page rollups."""
    s, e = window()
    tot = query(svc, site, s, e, None, 1)
    rows = []
    for r in query(svc, site, s, e, ["query", "page"], 25000):
        rows.append({"query": r["keys"][0], "page": r["keys"][1], "clicks": r.get("clicks", 0),
                     "impressions": r.get("impressions", 0), "ctr": round(r.get("ctr", 0), 4),
                     "position": round(r.get("position", 0), 1)})
    rows.sort(key=lambda x: (-x["impressions"], x["query"], x["page"]))
    by_query = [row(r, "query") for r in sorted(query(svc, site, s, e, ["query"], 25000), key=lambda r: (-r["impressions"], r["keys"][0]))]
    by_page = [row(r, "page") for r in sorted(query(svc, site, s, e, ["page"], 25000), key=lambda r: (-r["impressions"], r["keys"][0]))]
    return {"schema_version": "1.0", "truth_source": "google_search_console_search_analytics", "site_url": site,
            "start_date": s, "end_date": e, "window_days": 28,
            "collected_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "totals": row(tot[0]) if tot else {"clicks": 0, "impressions": 0, "ctr": 0, "position": 0},
            "query_count": len(by_query), "page_count": len(by_page), "row_count": len(rows),
            "rows": rows, "by_query": by_query, "by_page": by_page}


def run_analytics(out_dir):
    svc, account = load_service()
    sites = list_sites(svc)
    summary = {"mode": "analytics", "service_account": account, "property_count": len(sites), "properties": []}
    for entry in sites:
        site = entry["siteUrl"]
        try:
            rec = collect_analytics(svc, site)
        except Exception as exc:
            rec = {"site_url": site, "error": str(exc)[:500]}
        write_json(out_dir, f"{slug(site)}.json", rec)
        summary["properties"].append({k: rec.get(k) for k in ("site_url", "totals", "query_count", "page_count", "row_count", "error")})
        print(f"{site}: {rec.get('totals')} rows={rec.get('row_count')} {rec.get('error', '')}")
    write_json(out_dir, "summary.json", summary)
    if not sites:
        sys.exit("service account can read zero Search Console properties")


def read_json(path, default=None):
    try:
        with open(path) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def named_stop(msg):
    print(f"NAMED STOP: {msg}")
    sys.exit(0)


def daily_coverage(creds, site, data_dir, now):
    _, pages, notes = discover_sitemaps(site)
    home = site_root(site)
    own = [u for u in pages if in_property(site, u)]
    universe = [home] + [u for u in own if u.rstrip("/") != home.rstrip("/")]
    prev = read_json(os.path.join(data_dir, "index_coverage.json"), {}) or {}
    prev_rows = {r["url"]: r for r in prev.get("urls", []) if r.get("url") in set(universe)}
    # Rotation: the homepage, then never-inspected URLs in sitemap order, then the
    # oldest inspections. Over ceil(N/150) days every sitemap URL is inspected.
    order = {u: i for i, u in enumerate(universe)}
    rest = sorted(universe[1:], key=lambda u: (u in prev_rows, (prev_rows.get(u) or {}).get("inspected_at") or "", order[u]))
    batch = ([home] + rest)[:INSPECT_CAP_PER_PROPERTY]
    local_svc = threading.local()

    def inspect(url):
        if not hasattr(local_svc, "svc"):
            local_svc.svc = make_service(creds)
        try:
            res = local_svc.svc.urlInspection().index().inspect(
                body={"inspectionUrl": url, "siteUrl": site}).execute().get("inspectionResult", {})
            idx = res.get("indexStatusResult", {})
            return {"url": url, "bucket": bucket(res), "verdict": idx.get("verdict"),
                    "coverageState": idx.get("coverageState"), "lastCrawlTime": idx.get("lastCrawlTime"),
                    "googleCanonical": idx.get("googleCanonical"), "userCanonical": idx.get("userCanonical"),
                    "inspected_at": now}
        except Exception as exc:
            return {"url": url, "bucket": "error", "error": str(exc)[:300], "inspected_at": now}

    with cf.ThreadPoolExecutor(INSPECT_PARALLEL) as pool:
        fresh = list(pool.map(inspect, batch))
    ok = [r for r in fresh if r["bucket"] != "error"]
    if batch and not ok:
        named_stop(f"URL Inspection failed for all {len(batch)} URLs of {site}: {fresh[0].get('error')}")
    for r in ok:
        prev_rows[r["url"]] = r
    rows = [prev_rows[u] for u in universe if u in prev_rows]
    by_state, buckets = {}, {}
    for r in rows:
        by_state[r.get("coverageState") or r["bucket"]] = by_state.get(r.get("coverageState") or r["bucket"], 0) + 1
        buckets[r["bucket"]] = buckets.get(r["bucket"], 0) + 1
    return {"schema_version": "1.0", "truth_source": "google_search_console_url_inspection", "site_url": site,
            "collected_at": now, "state": "OK", "sitemap_url_count": len(universe),
            "inspected_this_run": len(ok), "errors_this_run": len(fresh) - len(ok),
            "inspected_total": len(rows), "never_inspected": len(universe) - len(rows),
            "quota": {"daily_limit_per_property": 2000, "cap_per_site_per_day": INSPECT_CAP_PER_PROPERTY,
                      "parallel": INSPECT_PARALLEL, "portfolio_daily_budget": INSPECT_DAILY_BUDGET},
            "rotation": "homepage first, then never-inspected sitemap URLs in sitemap order, then oldest inspection first",
            "summary": {"by_coverage_state": dict(sorted(by_state.items())), "buckets": dict(sorted(buckets.items()))},
            "notes": notes, "urls": rows}


def daily_sitemaps(svc_write, site, now):
    before = sitemap_state(svc_write.sitemaps().list(siteUrl=site).execute().get("sitemap", []))
    found, pages, notes = discover_sitemaps(site)
    own = [u for u in found if in_property(site, u)]
    submitted, errors = [], {}
    if not before:  # submit only when the property lists no sitemap at all
        for url in own:
            try:
                svc_write.sitemaps().submit(siteUrl=site, feedpath=url).execute()
                submitted.append(url)
            except Exception as exc:
                errors[url] = str(exc)[:300]
    after = sitemap_state(svc_write.sitemaps().list(siteUrl=site).execute().get("sitemap", [])) if submitted else before
    return {"schema_version": "1.0", "site_url": site, "collected_at": now, "live_sitemaps": own,
            "sitemap_page_urls": len(pages), "listed_before": before, "submitted": submitted,
            "submit_errors": errors, "listed_after": after, "notes": notes}


def run_daily(site, data_dir):
    if not os.environ.get("GSC_SERVICE_ACCOUNT_JSON"):
        named_stop("GSC_SERVICE_ACCOUNT_JSON is not set; Search Console files left as they were")
    os.makedirs(data_dir, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    creds, account = load_creds(READONLY)
    svc = make_service(creds)
    try:
        analytics = collect_analytics(svc, site)
    except Exception as exc:
        named_stop(f"search analytics unreadable for {site} as {account}: {str(exc)[:300]}")
    write_json(data_dir, "gsc_search_analytics_export.json", analytics)
    print(f"{site}: analytics rows={analytics['row_count']} queries={analytics['query_count']} totals={analytics['totals']}")
    try:
        wcreds, _ = load_creds(WRITE)
        write_json(data_dir, "gsc_sitemaps.json", daily_sitemaps(make_service(wcreds), site, now))
    except Exception as exc:
        print(f"NAMED STOP: sitemaps.list unreadable for {site}: {str(exc)[:300]}")
    cov = daily_coverage(creds, site, data_dir, now)
    write_json(data_dir, "index_coverage.json", cov)
    print(f"{site}: coverage inspected_this_run={cov['inspected_this_run']} total={cov['inspected_total']}/{cov['sitemap_url_count']} {cov['summary']['by_coverage_state']}")


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
    args = sys.argv[1:]
    mode = "report"
    if args[:1] == ["--mode"]:
        mode, args = args[1], args[2:]
    site = None
    if args[:1] == ["--site"]:
        site, args = args[1], args[2:]
    if mode not in ("report", "sitemaps", "coverage", "analytics", "daily"):
        sys.exit(f"unknown mode {mode!r}; expected report, sitemaps, coverage, analytics or daily")
    if mode == "daily":
        if not site:
            sys.exit("--mode daily needs --site <property>")
        return run_daily(site, args[0] if args else "data/search_intelligence")
    out_dir = args[0] if args else f"gsc-{mode}"
    os.makedirs(out_dir, exist_ok=True)
    if mode == "sitemaps":
        return run_sitemaps(out_dir)
    if mode == "coverage":
        return run_coverage(out_dir)
    if mode == "analytics":
        return run_analytics(out_dir)
    svc, account = load_service()
    end = dt.date.today() - dt.timedelta(days=3)
    start = end - dt.timedelta(days=27)
    s, e = start.isoformat(), end.isoformat()
    sites = list_sites(svc)
    summary = {"mode": "report", "service_account": account, "start_date": s, "end_date": e,
               "property_count": len(sites), "properties": []}
    for entry in sites:
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
        write_json(out_dir, f"{slug(site)}.json", rec)
        summary["properties"].append({k: rec.get(k) for k in
            ("site", "permission", "totals", "query_count", "pages_with_impressions", "error")})
        print(f"{site}: {rec.get('totals')} queries={rec.get('query_count')} pages={rec.get('pages_with_impressions')} {rec.get('error','')}")
    write_json(out_dir, "summary.json", summary)
    if not sites:
        sys.exit("service account can read zero Search Console properties")


if __name__ == "__main__":
    main()
