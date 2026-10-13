#!/usr/bin/env python3
"""Weekly search-outcome report: is the search work helping, across the portfolio.

Usage: search_outcomes_weekly.py --mode report [out_dir]
       search_outcomes_weekly.py --mode email  <report.md>

report  For every Search Console property the service account can read:
        the last 7 complete days (ending 3 days ago, Search Console's data lag)
        against the 7 before them - clicks, impressions, average position,
        pages with impressions, top 3 queries by impressions with position -
        plus the 28-day totals. Index coverage is NOT re-inspected: each owning
        repo's committed index_coverage.json is read from GitHub raw (every repo
        is public), now and as it stood 7 days ago, so "indexed share fell" is a
        measured comparison. strengthened_pages.json / strengthening_ledger.json
        give pages strengthened this week (routes present now and absent from
        the version 7 days ago); consolidation_candidates.json gives candidates
        pending. A repo with no such file is recorded as "no coverage file" and
        never fails the run. The top 25 pages by 28-day impressions on every
        property are requested (HEAD, GET when HEAD is refused); a 404/410 is a
        red flag.

        Verdict per site:
          RED   impressions down >25% week over week on >=20 prior impressions,
                or any measured URL 404/410, or the indexed share fell by
                >=2 points, or Search Console could not be read.
          GREEN impressions up >10%, or flat with clicks > 0, or the indexed
                share rose by >=2 points.
          WATCH anything else (flat, no clicks).
        The 2-point margin on indexed share is there because coverage files
        rotate through their sitemaps, so a one-URL wobble is not a trend.

        Writes <out_dir>/<ISO-week>.md and <ISO-week>.json (default out_dir
        reports/search_outcomes), then opens or updates ONE issue per RED site in
        this repo ("Search outcome RED: <site> <week>"; an open issue for the
        same site from an earlier week is retitled, not duplicated) and closes
        the site's open issue when it is GREEN. Exits non-zero when the account
        reads zero properties (Rule 0). Without GITHUB_TOKEN the issue step is a
        NAMED STOP line.

email   Sends the markdown report to the owner through Resend. Without
        RESEND_API_KEY it prints a NAMED STOP naming the owner step and exits 0;
        a provider refusal exits 1. The key is read from the environment only.
"""
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

THIS_REPO = os.environ.get("GITHUB_REPOSITORY", "seq23/local-guides-citation-velocity")
OWNER = "seq23"
# Repos whose committed search-intelligence files are read. Coverage paths are
# discovered from each repo's tree, never hard-coded.
COVERAGE_REPOS = [
    "p-n-p", "approvalprep", "dream-wedding-builder", "local-guides-generator",
    "local-guides-citation-velocity", "dianne-place-recovery-services", "WPP-llm",
    "horse-legal-guide-velocity", "authority-backlink-network", "sprylabs-hpc-site",
]
# Owner for properties no coverage file names. Coverage files win over this map.
FALLBACK_OWNER = {
    "horselegalguide.com": "horse-legal-guide-velocity",
    "founderoperatorlibrary.com": "authority-backlink-network",
    "memphisvendorlibrary.com": "authority-backlink-network",
    "professionalresourcelibrary.com": "authority-backlink-network",
    "billionairehighperformancecoach.com": "sprylabs-hpc-site",
    "spryexecutiveos.com": "sprylabs-hpc-site",
    "aplayermode.com": "sprylabs-hpc-site",
    "thedentistryguides.com": "local-guides-generator",
    "hicksconsulting.org": "hicks-consulting-canonical",
    "memphisseniorcarehomes.com": "local-guides-generator",
}
# Portfolio properties this report must cover once the service account can see
# them. A property registered but not yet shared with the account (or still
# verifying) is a NOTICE in the report, never a failure: the run stays green and
# the row appears on the first week the account can read it.
# memphisseniorcarehomes.com: senior-living canonical (local-guides-generator),
# registration started 13 Oct 2026.
EXPECTED_PROPERTIES = {
    "memphisseniorcarehomes.com": "local-guides-generator",
}
# Lead funnel next to search, so search -> leads reads as one line per property.
# GET <origin>/api/senior-funnel?days=7 with header x-senior-tick-token (repo secret
# SENIOR_TICK_TOKEN, the same value local-guides-generator holds). No token ->
# "funnel: no token"; any fetch/parse failure -> "funnel: unavailable". Neither is
# ever RED: only the measured rule below is.
FUNNEL_ENDPOINTS = {
    "memphisseniorcarehomes.com": "https://memphisseniorcarehomes.com/api/senior-funnel?days=7",
}
FUNNEL_TOKEN_ENV = "SENIOR_TICK_TOKEN"
# RED: people land from search but nobody starts the intake -> the intake is not
# reachable from the pages they land on.
FUNNEL_RED_MIN_CLICKS = 20


def fetch_funnel(host, fetch=None):
    url = FUNNEL_ENDPOINTS.get(host)
    if not url:
        return None
    token = os.environ.get(FUNNEL_TOKEN_ENV, "").strip()
    if not token:
        return {"status": "no_token"}
    try:
        status, raw = (fetch or http)(url, "GET", None, {"x-senior-tick-token": token}, 20)
        doc = json.loads(raw or b"{}")
        if status != 200 or not doc.get("ok"):
            return {"status": "unavailable", "http_status": status}
        fu = doc.get("followup_outcomes") or {}
        by_page = sorted(doc.get("leads_by_page") or [], key=lambda r: -int(r.get("leads") or 0))
        return {
            "status": "ok",
            "intake_starts": int(doc.get("intake_starts") or 0),
            "leads": int(doc.get("contact_submitted") or 0),
            "unsellable": int(doc.get("unsellable") or 0),
            "teasers": int(doc.get("teasers_sent") or 0),
            "accepts_flat": int(doc.get("accepts_flat") or 0),
            "accepts_rent": int(doc.get("accepts_rent") or 0),
            "releases": int(doc.get("releases") or 0),
            "moved_in": int(fu.get("moved_in") or 0),
            "top_sources": [{"page_slug": r.get("page_slug") or "(none)", "leads": int(r.get("leads") or 0)} for r in by_page[:5]],
        }
    except Exception as exc:  # a funnel outage must never hide or redden the search row
        return {"status": "unavailable", "error": str(exc)[:200]}


def funnel_verdict(m, fun, v, why):
    """Overrides the search verdict only on the measured funnel rule."""
    if not fun or fun.get("status") != "ok" or m.get("error"):
        return v, why
    clicks = int((m.get("current") or {}).get("clicks") or 0)
    if clicks >= FUNNEL_RED_MIN_CLICKS and fun["intake_starts"] == 0:
        return "RED", (f"{clicks} search clicks this week and 0 intake starts: the intake is not reachable "
                       "from the pages people land on")
    return v, why


def funnel_line(s):
    fun = s.get("funnel")
    if not fun:
        return None
    c = s.get("current") or {}
    if fun.get("status") == "no_token":
        return f"funnel: no token (set repo secret {FUNNEL_TOKEN_ENV})"
    if fun.get("status") != "ok":
        return "funnel: unavailable"
    src = ", ".join(f"{r['page_slug']} ({r['leads']})" for r in fun["top_sources"]) or "none"
    return (f"impressions {c.get('impressions', '-')}, clicks {c.get('clicks', '-')}, intake starts {fun['intake_starts']}, "
            f"leads {fun['leads']}, unsellable {fun['unsellable']}, teasers {fun['teasers']}, accepts "
            f"{fun['accepts_flat']} flat / {fun['accepts_rent']} rent, releases {fun['releases']}, moved-in {fun['moved_in']}; "
            f"top lead sources: {src}")
# Sender pinned in code, never read from the environment (owner rule, 12 Oct 2026):
# The Industry Guides never sends under another company's name. Sent through the
# Resend account that verifies theindustryguides.com (repo secret RESEND_API_KEY).
# scripts/lib/brand_separation.js fails the build if this line changes.
FROM = "The Industry Guides <hello@theindustryguides.com>"
TO = "sequoia@westpeek.ventures"   # recipient: the owner's own inbox
SHARE_MARGIN = 0.02
UA = "Mozilla/5.0 (compatible; search-outcomes-weekly)"
FILE_RX = re.compile(r"(^|/)(index_coverage|strengthening_ledger|strengthened_pages|consolidation_candidates)\.json$")


# ------------------------------------------------------------------ http helpers
def http(url, method="GET", body=None, headers=None, timeout=30):
    h = {"User-Agent": UA}
    h.update(headers or {})
    data = json.dumps(body).encode() if body is not None else None
    if data is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def gh(path, method="GET", body=None):
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    hdr = {"Accept": "application/vnd.github+json"}
    if tok:
        hdr["Authorization"] = f"Bearer {tok}"
    status, raw = http(f"https://api.github.com/{path}", method, body, hdr)
    try:
        return status, json.loads(raw or b"null")
    except ValueError:
        return status, None


def raw_json(repo, ref, path):
    status, raw = http(f"https://raw.githubusercontent.com/{OWNER}/{repo}/{ref}/{urllib.parse.quote(path)}")
    if status != 200:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def host_of(url_or_site):
    s = str(url_or_site or "")
    if s.startswith("sc-domain:"):
        return s.split(":", 1)[1].lower()
    h = urllib.parse.urlsplit(s).hostname or ""
    return h.lower().removeprefix("www.")


# ------------------------------------------------------------- coverage reading
def _counts(obj):
    """state -> count from any coverage summary shape this portfolio writes."""
    s = obj.get("summary") or {}
    for c in (s.get("by_coverage_state"), obj.get("counts_by_coverage_state")):
        if isinstance(c, dict) and c:
            return {k: v for k, v in c.items() if isinstance(v, (int, float))}
    b = s.get("buckets") or obj.get("buckets")
    if isinstance(b, dict) and b:
        return {("Submitted and indexed" if k == "indexed" else k): v for k, v in b.items()
                if k != "not_inspected" and isinstance(v, (int, float))}
    return {}


def indexed_share(counts):
    total = sum(counts.values())
    if not total:
        return None
    idx = sum(v for k, v in counts.items() if "indexed" in k.lower() and "not indexed" not in k.lower())
    return round(idx / total, 4)


def coverage_by_host(doc, path):
    """{host: state counts} from one coverage file of any known shape."""
    out = {}
    if not isinstance(doc, dict):
        return out
    hosts = doc.get("hosts")
    if isinstance(hosts, dict):
        for h, v in hosts.items():
            if isinstance(v, dict):
                out[host_of(v.get("site_property") or h) or h.lower()] = _counts(v)
        return out
    host = host_of(doc.get("site_url") or doc.get("property") or doc.get("site"))
    if not host:
        seg = path.split("/")
        if len(seg) >= 3 and "." in seg[-2]:
            host = seg[-2].lower()
    if not host:
        urls = doc.get("urls") or doc.get("results")
        first = next(iter(urls), None) if isinstance(urls, (dict, list)) and urls else None
        host = host_of(first if isinstance(first, str) else (first or {}).get("url"))
    if host:
        out[host] = _counts(doc)
    return out


def ref_week_ago(repo, path, until):
    st, commits = gh(f"repos/{OWNER}/{repo}/commits?path={urllib.parse.quote(path)}&until={until}&per_page=1")
    if st == 200 and commits:
        return commits[0]["sha"]
    return None


def strengthened_routes(doc):
    pages = (doc or {}).get("pages") or (doc or {}).get("entries") or (doc or {}).get("rows") or []
    out = set()
    for p in pages if isinstance(pages, list) else []:
        if isinstance(p, dict):
            out.add((host_of(p.get("host") and "sc-domain:" + p["host"]) or None,
                     p.get("route") or p.get("url") or p.get("page")))
    return out


def candidate_count(doc):
    if not isinstance(doc, dict):
        return 0, None
    host = host_of(doc.get("host") and "sc-domain:" + doc["host"]) or None
    if isinstance(doc.get("candidate_count"), int):
        return doc["candidate_count"], host
    if isinstance(doc.get("candidates"), list):
        return len(doc["candidates"]), host
    rows = doc.get("rows") or []
    n = sum(1 for r in rows if isinstance(r, dict) and r.get("role") == "candidate")
    if rows and not host:
        host = host_of(rows[0].get("url"))
    return n, host


def read_repo_files(now):
    """Per host: owner repo, coverage now/prior, strengthened this week, candidates pending."""
    until = (now - dt.timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
    hosts, repo_notes = {}, {}

    def slot(h):
        return hosts.setdefault(h, {"owner": None, "coverage_file": None, "share_now": None, "share_prior": None,
                                    "strengthened_this_week": 0, "candidates_pending": None})

    for repo in COVERAGE_REPOS:
        st, info = gh(f"repos/{OWNER}/{repo}")
        branch = (info or {}).get("default_branch", "main") if st == 200 else "main"
        st, tree = gh(f"repos/{OWNER}/{repo}/git/trees/{branch}?recursive=1")
        if st != 200 or not tree:
            repo_notes[repo] = f"tree unreadable ({st})"
            continue
        files = sorted(e["path"] for e in tree.get("tree", []) if FILE_RX.search(e["path"]) and "node_modules" not in e["path"])
        cov = [f for f in files if f.endswith("index_coverage.json")]
        repo_notes[repo] = "no coverage file" if not cov else f"{len(cov)} coverage file(s)"
        repo_hosts = []
        for f in cov:
            now_doc = raw_json(repo, branch, f)
            sha = ref_week_ago(repo, f, until)
            prior_doc = raw_json(repo, sha, f) if sha else None
            prior = coverage_by_host(prior_doc, f) if prior_doc else {}
            for h, counts in coverage_by_host(now_doc, f).items():
                s = slot(h)
                s.update(owner=repo, coverage_file=f"{repo}/{f}", share_now=indexed_share(counts),
                         share_prior=indexed_share(prior.get(h, {})) if prior.get(h) else None)
                repo_hosts.append(h)
        for f in files:
            if f.endswith(("strengthened_pages.json", "strengthening_ledger.json")):
                now_set = strengthened_routes(raw_json(repo, branch, f))
                sha = ref_week_ago(repo, f, until)
                new = now_set - (strengthened_routes(raw_json(repo, sha, f)) if sha else set())
                for h, _route in new:
                    target = h or (repo_hosts[0] if len(repo_hosts) == 1 else None)
                    if target:
                        slot(target)["strengthened_this_week"] += 1
            elif f.endswith("consolidation_candidates.json"):
                doc = raw_json(repo, branch, f)
                if isinstance(doc, dict) and isinstance(doc.get("hosts"), dict):
                    for hh, sub in doc["hosts"].items():
                        n, _ = candidate_count(sub)
                        s = slot(hh.lower())
                        s["candidates_pending"] = (s["candidates_pending"] or 0) + n
                    continue
                n, h = candidate_count(doc)
                seg = f.split("/")
                h = h or (seg[-2].lower() if len(seg) >= 3 and "." in seg[-2] else None)
                h = h or (repo_hosts[0] if len(repo_hosts) == 1 else None)
                if h:
                    s = slot(h)
                    s["candidates_pending"] = (s["candidates_pending"] or 0) + n
        for h in repo_hosts:
            slot(h)["owner"] = repo
    return hosts, repo_notes


# ---------------------------------------------------------------- search reads
def windows(today):
    end = today - dt.timedelta(days=3)
    return {"current": (end - dt.timedelta(days=6), end), "prior": (end - dt.timedelta(days=13), end - dt.timedelta(days=7)),
            "d28": (end - dt.timedelta(days=27), end)}


def site_metrics(svc, site, win):
    from gsc_portfolio_report import query, row
    iso = lambda d: d.isoformat()
    out = {}
    for name in ("current", "prior", "d28"):
        s, e = map(iso, win[name])
        tot = query(svc, site, s, e, None, 1)
        out[name] = row(tot[0]) if tot else {"clicks": 0, "impressions": 0, "ctr": 0, "position": 0}
    s, e = map(iso, win["current"])
    pages = query(svc, site, s, e, ["page"], 25000)
    out["current"]["pages_with_impressions"] = len(pages)
    s0, e0 = map(iso, win["prior"])
    out["prior"]["pages_with_impressions"] = len(query(svc, site, s0, e0, ["page"], 25000))
    qs = sorted(query(svc, site, s, e, ["query"], 25000), key=lambda r: (-r["impressions"], r["keys"][0]))
    out["top_queries"] = [row(r, "query") for r in qs[:3]]
    s, e = map(iso, win["d28"])
    p28 = sorted(query(svc, site, s, e, ["page"], 25000), key=lambda r: (-r["impressions"], r["keys"][0]))
    out["top_pages_28d"] = [r["keys"][0] for r in p28[:25]]
    out["seeds"], out["measured_queries_28d"] = discovery_seeds(query(svc, site, s, e, ["query", "page"], 25000))
    return out


SEED_MIN_IMPRESSIONS = 2
SEED_CAP = 40


def discovery_seeds(rows):
    """Seeds for free_discovery.py: every query with >= 2 impressions in the 28-day
    window, its top landing page and position, capped at 40 by impressions. Also
    returns every query Google measured in the window (any impressions) so discovery
    never re-proposes something that already has an impression."""
    agg = {}
    for r in rows:
        q, page = r["keys"][0], r["keys"][1]
        a = agg.setdefault(q, {"query": q, "impressions": 0, "clicks": 0, "pages": {}, "wpos": 0.0})
        a["impressions"] += r.get("impressions", 0)
        a["clicks"] += r.get("clicks", 0)
        a["wpos"] += r.get("position", 0) * r.get("impressions", 0)
        a["pages"][page] = a["pages"].get(page, 0) + r.get("impressions", 0)
    seeds = []
    for a in agg.values():
        if a["impressions"] < SEED_MIN_IMPRESSIONS:
            continue
        page = sorted(a["pages"].items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        seeds.append({"query": a["query"], "page": page, "impressions": a["impressions"], "clicks": a["clicks"],
                      "position": round(a["wpos"] / a["impressions"], 1) if a["impressions"] else 0})
    seeds.sort(key=lambda x: (-x["impressions"], x["query"]))
    return seeds[:SEED_CAP], sorted(agg)


def url_status(url):
    status, _ = http(url, method="HEAD", timeout=20)
    if status in (403, 405, 501):
        status, _ = http(url, timeout=20)
    return status


def check_urls(urls):
    with cf.ThreadPoolExecutor(8) as ex:
        res = dict(zip(urls, ex.map(lambda u: _safe_status(u), urls)))
    return {u: s for u, s in res.items()}


def _safe_status(u):
    try:
        return url_status(u)
    except Exception as exc:  # network error is recorded, not a 404
        return f"error:{type(exc).__name__}"


# --------------------------------------------------------------------- verdicts
def verdict(m, cov):
    if m.get("error"):
        return "RED", f"Search Console read failed: {m['error'][:120]}"
    cur, pri = m["current"]["impressions"], m["prior"]["impressions"]
    dead = [u for u, s in (m.get("url_status") or {}).items() if s in (404, 410)]
    if dead:
        return "RED", f"{len(dead)} measured URL(s) return 404/410, e.g. {dead[0]}"
    if pri >= 20 and cur < 0.75 * pri:
        return "RED", f"impressions down {round(100 * (1 - cur / pri))}% week over week ({pri} -> {cur})"
    sn, sp = cov.get("share_now"), cov.get("share_prior")
    if sn is not None and sp is not None and sn <= sp - SHARE_MARGIN:
        return "RED", f"indexed share fell {sp:.0%} -> {sn:.0%}"
    if cur > pri * 1.10 and cur > pri:
        return "GREEN", f"impressions up ({pri} -> {cur})"
    if sn is not None and sp is not None and sn >= sp + SHARE_MARGIN:
        return "GREEN", f"indexed share rose {sp:.0%} -> {sn:.0%}"
    if m["current"]["clicks"] > 0 and cur >= pri * 0.90:
        return "GREEN", f"impressions flat ({pri} -> {cur}) with {m['current']['clicks']} click(s)"
    return "WATCH", f"impressions {pri} -> {cur}, {m['current']['clicks']} click(s)"


# ---------------------------------------------------------------------- output
def fmt_share(v):
    return "no coverage file" if v is None else f"{v:.0%}"


def render_md(rep):
    L = [f"# Search outcomes {rep['week']}", "",
         f"Last 7 complete days {rep['windows']['current'][0]}..{rep['windows']['current'][1]} vs "
         f"{rep['windows']['prior'][0]}..{rep['windows']['prior'][1]}; 28-day window ends {rep['windows']['d28'][1]}. "
         f"{rep['property_count']} properties. "
         f"GREEN {rep['counts']['GREEN']} / WATCH {rep['counts']['WATCH']} / RED {rep['counts']['RED']}.", "",
         "| site | impressions wk / prior | clicks | pages shown | indexed share | verdict | reason |",
         "|---|---|---|---|---|---|---|"]
    for s in rep["sites"]:
        c, p = s.get("current") or {}, s.get("prior") or {}
        share = fmt_share(s["coverage"]["share_now"])
        if s["coverage"]["share_now"] is not None and s["coverage"]["share_prior"] is not None:
            share += f" (was {s['coverage']['share_prior']:.0%})"
        L.append(f"| {s['host']} | {c.get('impressions', '-')} / {p.get('impressions', '-')} | {c.get('clicks', '-')} | "
                 f"{c.get('pages_with_impressions', '-')} | {share} | {s['verdict']} | {s['reason'].replace('|', '/')} |")
    L += ["", "## Detail", ""]
    for s in rep["sites"]:
        c, d = s.get("current") or {}, s.get("d28") or {}
        q = "; ".join(f"{x['query']} ({x['impressions']} impr, pos {x['position']})" for x in s.get("top_queries") or []) or "none"
        L.append(f"- **{s['host']}** ({s['verdict']}, owner {s['owner'] or 'unmapped'}): position {c.get('position', '-')}, "
                 f"28d {d.get('impressions', '-')} impr / {d.get('clicks', '-')} clicks; top queries: {q}; "
                 f"strengthened this week {s['coverage']['strengthened_this_week']}; consolidation candidates pending "
                 f"{'none recorded' if s['coverage']['candidates_pending'] is None else s['coverage']['candidates_pending']}; "
                 f"measured URLs checked {len(s.get('url_status') or {})}."
                 + (f" Search -> leads: {funnel_line(s)}." if funnel_line(s) else ""))
    if rep.get("pending_properties"):
        L += ["", "Not yet visible to the service account (skipped, not a failure): "
              + ", ".join(f"{p['host']} (owner {p['owner']})" for p in rep["pending_properties"]) + "."]
    L += ["", "Coverage sources: " + "; ".join(f"{r}: {n}" for r, n in sorted(rep["repo_notes"].items())), ""]
    return "\n".join(L)


def sync_issues(rep):
    if not (os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")):
        print("NAMED STOP: GITHUB_TOKEN not set; RED issues were not opened or closed (the report is still written).")
        return []
    prefix = "Search outcome RED: "
    open_by_host, page = {}, 1
    while True:
        st, items = gh(f"repos/{THIS_REPO}/issues?state=open&per_page=100&page={page}")
        if st != 200:
            sys.exit(f"issue list failed: {st}")
        for it in items or []:
            if "pull_request" not in it and it["title"].startswith(prefix):
                open_by_host.setdefault(it["title"][len(prefix):].rsplit(" ", 1)[0], it)
        if not items or len(items) < 100:
            break
        page += 1
    actions = []
    for s in rep["sites"]:
        h, existing = s["host"], open_by_host.get(s["host"])
        title = f"{prefix}{h} {rep['week']}"
        body = (f"**{h}** is RED in the weekly search-outcome report for {rep['week']}.\n\n"
                f"- Reason: {s['reason']}\n- Owning repo: {s['owner'] or 'unmapped'}\n"
                f"- Impressions last 7 days / prior 7: {(s.get('current') or {}).get('impressions')} / {(s.get('prior') or {}).get('impressions')}\n"
                f"- Indexed share: {fmt_share(s['coverage']['share_now'])}\n"
                f"- Report: reports/search_outcomes/{rep['week']}.md\n\n"
                "Closed automatically the first week this site is GREEN.")
        if s["verdict"] == "RED":
            if existing:
                gh(f"repos/{THIS_REPO}/issues/{existing['number']}", "PATCH", {"title": title, "body": body})
                gh(f"repos/{THIS_REPO}/issues/{existing['number']}/comments", "POST", {"body": f"Still RED in {rep['week']}: {s['reason']}"})
                actions.append(f"updated #{existing['number']} {h}")
            else:
                st, made = gh(f"repos/{THIS_REPO}/issues", "POST", {"title": title, "body": body})
                if st != 201:
                    sys.exit(f"issue create failed for {h}: {st}")
                actions.append(f"opened #{made['number']} {h}")
        elif s["verdict"] == "GREEN" and existing:
            gh(f"repos/{THIS_REPO}/issues/{existing['number']}/comments", "POST", {"body": f"GREEN in {rep['week']}: {s['reason']}. Closing."})
            gh(f"repos/{THIS_REPO}/issues/{existing['number']}", "PATCH", {"state": "closed", "state_reason": "completed"})
            actions.append(f"closed #{existing['number']} {h}")
    return actions


def run_report(out_dir):
    from gsc_portfolio_report import list_sites, load_service
    now = dt.datetime.now(dt.timezone.utc)
    iy, iw, _ = now.date().isocalendar()
    week = f"{iy}-W{iw:02d}"
    win = windows(now.date())
    svc, account = load_service()
    sites = [e["siteUrl"] for e in list_sites(svc)]
    if not sites:
        sys.exit("service account can read zero Search Console properties")
    visible = {host_of(s) for s in sites}
    pending = sorted(h for h in EXPECTED_PROPERTIES if h not in visible)
    for h in pending:
        print(f"NOTICE: {h} is not yet visible to {account}; skipped this week (Search Console registration pending)")
    cov_hosts, repo_notes = read_repo_files(now)
    rows = []
    measured_queries = {}
    for site in sites:
        h = host_of(site)
        try:
            m = site_metrics(svc, site, win)
            m["url_status"] = check_urls(m["top_pages_28d"])
        except Exception as exc:  # one unreadable property must not hide the rest
            m = {"error": str(exc)[:500]}
        cov = cov_hosts.get(h) or {"owner": None, "coverage_file": None, "share_now": None, "share_prior": None,
                                   "strengthened_this_week": 0, "candidates_pending": None}
        v, why = verdict(m, cov)
        fun = fetch_funnel(h)
        if fun is not None:
            m["funnel"] = fun
            v, why = funnel_verdict(m, fun, v, why)
        measured = m.pop("measured_queries_28d", [])
        if measured:
            measured_queries[h] = measured
        rows.append({"site": site, "host": h, "owner": cov.get("owner") or FALLBACK_OWNER.get(h), "verdict": v, "reason": why,
                     "coverage": cov, **m})
        print(f"{h}: {v} - {why}")
    counts = {k: sum(1 for r in rows if r["verdict"] == k) for k in ("GREEN", "WATCH", "RED")}
    rep = {"schema_version": "1.1", "week": week, "generated_at": now.isoformat(timespec="seconds"),
           "service_account": account, "property_count": len(sites), "site_count": len(rows),
           "windows": {k: [a.isoformat(), b.isoformat()] for k, (a, b) in win.items()},
           "counts": counts, "repo_notes": repo_notes, "sites": rows,
           "pending_properties": [{"host": h, "owner": EXPECTED_PROPERTIES[h],
                                   "notice": "not yet visible to the service account; skipped"} for h in pending]}
    md = render_md(rep)
    rep["issue_actions"] = sync_issues(rep)
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, f"{week}.json"), "w") as fh:
        json.dump(rep, fh, indent=2)
        fh.write("\n")
    with open(os.path.join(out_dir, f"{week}.md"), "w") as fh:
        fh.write(md)
    # Every query Google measured in the 28-day window, per host: free_discovery.py
    # drops any candidate already in it. Not committed (reports/ is gitignored and
    # the commit step adds only the .md/.json pair); discovery folds it into
    # data/discovery/measured_targets_snapshot.json, which is.
    with open(os.path.join(out_dir, f"{week}.gsc_queries.json"), "w") as fh:
        json.dump({"week": week, "window": rep["windows"]["d28"], "queries_by_host": measured_queries}, fh)
    print(f"wrote {out_dir}/{week}.md and .json: {len(rows)} sites, {counts}; issues: {rep['issue_actions']}")
    gho = os.environ.get("GITHUB_OUTPUT")
    if gho:
        with open(gho, "a") as fh:
            fh.write(f"week={week}\n")


def run_email(md_path):
    key = os.environ.get("RESEND_API_KEY", "")
    if not key:
        print("NAMED STOP: RESEND_API_KEY is not a secret of local-guides-citation-velocity. "
              "Owner step: add RESEND_API_KEY to local-guides-citation-velocity secrets. "
              "The report is committed and uploaded as an artifact; RED issues are open.")
        return
    text = open(md_path).read()
    week = os.path.basename(md_path).rsplit(".", 1)[0]
    m = re.search(r"GREEN (\d+) / WATCH (\d+) / RED (\d+)", text)
    subject = f"Search outcomes {week}" + (f": {m.group(3)} RED, {m.group(2)} WATCH, {m.group(1)} GREEN" if m else "")
    status, raw = http("https://api.resend.com/emails", "POST",
                       {"from": FROM, "to": [TO], "subject": subject, "text": text},
                       {"Authorization": f"Bearer {key}"})
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        body = {}
    if status in (200, 201) and body.get("id"):
        print(f"sent id={body['id']}")
        return
    sys.exit(f"resend {status}: {body.get('message') or body.get('name') or 'no id returned'}")


def main():
    args = sys.argv[1:]
    mode = "report"
    if args[:1] == ["--mode"]:
        mode, args = args[1], args[2:]
    if mode == "report":
        return run_report(args[0] if args else "reports/search_outcomes")
    if mode == "email":
        if not args:
            sys.exit("--mode email needs <report.md>")
        return run_email(args[0])
    sys.exit(f"unknown mode {mode!r}; expected report or email")


if __name__ == "__main__":
    main()
