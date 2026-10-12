#!/usr/bin/env python3
"""Free query discovery, seeded only from measured Search Console data. $0, no keys.

Usage: free_discovery.py <reports/search_outcomes/<week>.json> [data/discovery]

Replaces the useful part of the paused paid "Query Discovery Engine" (deep-research
calls, paid SERP/PAA scraping, an 11,823-row table read by paid citation monitors).

1. Seeds: per property, the queries with >= 2 impressions in the last 28 days, with
   their top landing page and position, capped at 40 by impressions. They come from
   the weekly report's own search-analytics pull (search_outcomes_weekly.py writes
   `seeds` per site); nothing here invents a seed.
2. Free expansion per seed:
   - Google autocomplete (suggestqueries.google.com, client=firefox): the seed, plus
     "<seed> a".."<seed> e" (5 letters max) for each property's top 10 seeds.
   - Google "People also ask" from the plain SERP HTML: probed ONCE per run. Google
     serves results only to JavaScript clients and rate-limits automated reads, so a
     probe that does not return PAA markup records `paa: unavailable` for the run and
     nothing retries it. No paid SERP API exists in this file.
   - Reddit search.json (no key, descriptive User-Agent, one request every 6.5 s,
     under the unauthenticated 10/minute limit): question-phrased titles only, <= 25
     per seed. Two refusals in a row record `reddit: unavailable` for the run.
   Every candidate keeps its seed query, seed page, source, and the seed's
   impressions/position.
3. Dedupe: dropped if it already exists in any portfolio repo's measured target set or
   demand families (target_query_set.json / demand_families.json /
   measured_targets.json, read from GitHub), in any query Google measured for any
   property in the window, or in a previous week's discovery file.
   Intent is rule-based: cost/price/near me = commercial; best/vs/compare =
   comparison; how/what/why (and other question words) = informational; the name of
   the seed's own page = service. The free-router intent pass is not used: rule-based
   tagging is enough for FAQ/H2 questions, so the run makes zero model calls.
4. Writes data/discovery/<week>/<host>.json per property with seeds, and
   data/discovery/measured_targets_snapshot.json (the dedupe set, so the validator can
   prove no candidate is a measured target), and appends a Discovery section to the
   weekly report .md/.json so the Monday email carries it.

RULE (written into every file and the report): a candidate cannot publish a page
anywhere until Google shows an impression for it. Its use now is the FAQ/H2 questions
on the seed's existing page (`questions_for_page`), which the strengthening passes read.

Paid calls: none possible. Every request goes through fetch(), which refuses any host
outside FREE_HOSTS and counts requests per host into the receipt; the validator
(validate_search_outcomes_weekly_report.js) checks the receipt.
"""
import datetime as dt
import glob
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OWNER = "seq23"
DEDUPE_REPOS = ["p-n-p", "approvalprep", "dream-wedding-builder", "local-guides-generator",
                "local-guides-citation-velocity", "WPP-llm", "dianne-place-recovery-services",
                "horse-legal-guide-velocity", "authority-backlink-network", "hicks-consulting-canonical",
                "sprylabs-hpc-site"]
DEDUPE_FILE_RX = re.compile(r"(^|/)(target_query_set|demand_families|measured_targets)\.json$")
QUERY_KEYS = {"query", "queries", "top_query", "head_query", "head_term", "target_query", "keyword", "question",
              "questions", "term"}
FREE_HOSTS = {"suggestqueries.google.com", "www.google.com", "www.reddit.com", "raw.githubusercontent.com",
              "api.github.com"}
UA_BROWSERLESS = "lgcv-free-discovery/1.0 (weekly query research from Search Console seeds; +https://github.com/seq23/local-guides-citation-velocity)"
RULE = ("A candidate cannot publish a page anywhere until Google shows an impression for it. Its use now is the "
        "FAQ/H2 questions on the seed's existing page (questions_for_page), which the strengthening passes read.")
SUFFIX_LETTERS = "abcde"
SUFFIX_TOP_SEEDS = 10
REDDIT_PER_SEED = 25
REDDIT_DELAY = 6.5
SUGGEST_DELAY = 0.3
BUDGET_SECONDS = int(os.environ.get("DISCOVERY_BUDGET_SECONDS", "1500"))
QUESTION_WORDS = ("how", "what", "why", "when", "where", "which", "who", "whom", "whose", "is", "are", "can", "could",
                  "should", "does", "do", "did", "will", "would", "was", "were", "has", "have")
STOP = set("a an the and or of for to in on at by with is are be my your our i me we you it this that from as do does how "
           "what why when where which who can should".split())

receipt = {"requests_by_host": {}, "refused_hosts": [], "model_calls": 0, "cost_usd": 0,
           "model_pass": "skipped: rule-based intent only (no model call made)"}


def fetch(url, headers=None, timeout=20):
    host = urllib.parse.urlsplit(url).hostname or ""
    if host not in FREE_HOSTS:
        receipt["refused_hosts"].append(host)
        raise RuntimeError(f"refused non-free host {host}")
    receipt["requests_by_host"][host] = receipt["requests_by_host"].get(host, 0) + 1
    h = {"User-Agent": UA_BROWSERLESS}
    h.update(headers or {})
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if host == "api.github.com" and tok:
        h["Authorization"] = f"Bearer {tok}"
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), r.headers.get_content_charset() or "utf-8", dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), "utf-8", dict(e.headers or {})
    except Exception as exc:  # network error = this request produced nothing
        return 0, str(exc).encode(), "utf-8", {}


def norm(q):
    q = str(q or "").lower().replace("’", "'")
    q = re.sub(r"[^\w\s']", " ", q)
    return re.sub(r"\s+", " ", q).strip()


def content_words(q):
    return {w for w in norm(q).split() if w not in STOP and len(w) > 2}


def is_question(t):
    t = t.strip()
    return t.endswith("?") or (norm(t).split()[:1] or [""])[0] in QUESTION_WORDS


def page_path(url):
    p = urllib.parse.urlsplit(url).path or "/"
    return p


def intent_of(cand, seed_page):
    n = f" {norm(cand)} "
    if re.search(r" (cost|costs|price|prices|pricing|fee|fees|cheap|cheapest|afford|affordable|near me|how much|quote|rates?) ", n):
        return "commercial"
    if re.search(r" (best|vs|versus|compare|comparison|alternatives?|top \d+|or) ", n):
        return "comparison"
    if (n.split()[:1] or [""])[0] in QUESTION_WORDS or cand.strip().endswith("?"):
        return "informational"
    slug = norm(page_path(seed_page).rstrip("/").rsplit("/", 1)[-1].replace("-", " "))
    if len(slug) >= 4 and slug in norm(cand):
        return "service"
    return "unclassified"


def collect_queries(obj, out, key=None):
    if isinstance(obj, dict):
        for k, v in obj.items():
            collect_queries(v, out, k)
    elif isinstance(obj, list):
        for v in obj:
            collect_queries(v, out, key)
    elif isinstance(obj, str) and key in QUERY_KEYS:
        n = norm(obj)
        if n:
            out.add(n)


def remote_targets():
    sources, found = [], set()
    for repo in DEDUPE_REPOS:
        st, raw, _, _ = fetch(f"https://api.github.com/repos/{OWNER}/{repo}/git/trees/HEAD?recursive=1")
        if st != 200:
            sources.append({"repo": repo, "status": f"tree http {st}"})
            continue
        paths = [t["path"] for t in json.loads(raw).get("tree", []) if DEDUPE_FILE_RX.search(t.get("path", ""))]
        if not paths:
            sources.append({"repo": repo, "status": "no target/demand files"})
        for p in paths:
            st, raw, _, _ = fetch(f"https://raw.githubusercontent.com/{OWNER}/{repo}/HEAD/{urllib.parse.quote(p)}")
            got = set()
            if st == 200:
                try:
                    collect_queries(json.loads(raw), got)
                except ValueError:
                    st = "unparseable"
            sources.append({"repo": repo, "path": p, "status": "ok" if st == 200 else f"http {st}", "queries": len(got)})
            found |= got
    return sources, found


def previous_discoveries(out_root, week):
    seen = set()
    for f in glob.glob(os.path.join(out_root, "*", "*.json")):
        if os.path.basename(os.path.dirname(f)) == week:
            continue
        try:
            for c in json.load(open(f)).get("candidates", []):
                seen.add(norm(c.get("query")))
        except (ValueError, OSError):
            pass
    return seen


class Sources:
    def __init__(self):
        self.state = {"autocomplete": "ok", "paa": "not probed", "reddit": "ok"}
        self.counts = {"autocomplete": 0, "paa": 0, "reddit": 0}
        self.reddit_fail = 0
        self.suggest_fail = 0
        self.last_reddit = 0.0

    def autocomplete(self, q):
        if self.state["autocomplete"] != "ok":
            return []
        st, raw, cs, _ = fetch("https://suggestqueries.google.com/complete/search?client=firefox&hl=en&ie=utf-8&oe=utf-8&q="
                               + urllib.parse.quote(q))
        time.sleep(SUGGEST_DELAY)
        if st == 400:  # Google refuses over-long queries one by one; not a source outage
            return []
        if st != 200:
            self.suggest_fail += 1
            if self.suggest_fail >= 3:
                self.state["autocomplete"] = f"unavailable (http {st})"
            return []
        self.suggest_fail = 0
        try:
            data = json.loads(raw.decode(cs, "replace"))
            return [s for s in data[1] if isinstance(s, str)]
        except (ValueError, IndexError):
            return []

    def paa(self, q):
        if self.state["paa"] == "not probed":
            st, raw, cs, _ = fetch("https://www.google.com/search?hl=en&gl=us&q=" + urllib.parse.quote(q),
                                   {"Accept-Language": "en-US"})
            html = raw.decode(cs, "replace")
            qs = paa_questions(html)
            if st == 200 and qs:
                self.state["paa"] = "ok"
                return qs
            why = "rate limited" if st == 429 or "/sorry/" in html else ("JavaScript required" if "enablejs" in html or "noscript" in html else f"http {st}, no PAA markup")
            self.state["paa"] = f"unavailable ({why}; probed once, not retried)"
            return []
        if self.state["paa"] != "ok":
            return []
        time.sleep(5)
        st, raw, cs, _ = fetch("https://www.google.com/search?hl=en&gl=us&q=" + urllib.parse.quote(q))
        if st != 200:
            self.state["paa"] = f"unavailable (http {st} after {self.counts['paa']} ok)"
            return []
        return paa_questions(raw.decode(cs, "replace"))

    def reddit(self, q):
        if self.state["reddit"] != "ok":
            return []
        wait = REDDIT_DELAY - (time.time() - self.last_reddit)
        if wait > 0:
            time.sleep(wait)
        self.last_reddit = time.time()
        st, raw, cs, hdr = fetch("https://www.reddit.com/search.json?sort=relevance&t=year&limit=100&q=" + urllib.parse.quote(q))
        if st != 200:
            self.reddit_fail += 1
            if self.reddit_fail >= 2:
                self.state["reddit"] = f"unavailable (http {st})"
            return []
        self.reddit_fail = 0
        try:
            posts = [c["data"] for c in json.loads(raw.decode(cs, "replace"))["data"]["children"]]
        except (ValueError, KeyError, TypeError):
            return []
        seed_words = content_words(q)
        out = []
        for p in posts:
            t = re.sub(r"\s+", " ", str(p.get("title") or "")).strip()
            if p.get("over_18") or not t or len(t) > 160 or not is_question(t):
                continue
            if seed_words and not (seed_words & content_words(t)):
                continue
            out.append(t)
            if len(out) >= REDDIT_PER_SEED:
                break
        return out


def paa_questions(html):
    if "People also ask" not in html:
        return []
    qs = re.findall(r'data-q="([^"]{8,200})"', html)
    return list(dict.fromkeys(q.replace("&#39;", "'").replace("&amp;", "&").replace("&quot;", '"') for q in qs))


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit("usage: free_discovery.py <report.json> [out_root]")
    report_path, out_root = args[0], (args[1] if len(args) > 1 else "data/discovery")
    rep = json.load(open(report_path))
    week = rep["week"]
    gsc_path = report_path[: -len(".json")] + ".gsc_queries.json"
    gsc = json.load(open(gsc_path)) if os.path.exists(gsc_path) else {"queries_by_host": {}}
    started = time.time()

    sites = [s for s in rep["sites"] if s.get("seeds")]
    remote_sources, remote = remote_targets()
    measured = set(remote)
    for qs in gsc.get("queries_by_host", {}).values():
        measured |= {norm(q) for q in qs}
    for s in rep["sites"]:
        measured |= {norm(x["query"]) for x in s.get("seeds") or []}
    prior = previous_discoveries(out_root, week)

    src = Sources()
    # Seeds expanded in portfolio-wide impression order, so a budget cut-off loses the least.
    queue = []
    for s in sites:
        for rank, seed in enumerate(s["seeds"]):
            queue.append((seed["impressions"], s["host"], rank, seed))
    queue.sort(key=lambda t: (-t[0], t[1], t[2]))
    found = {s["host"]: {} for s in sites}
    expanded = {s["host"]: 0 for s in sites}
    deferred = {s["host"]: 0 for s in sites}
    dropped = {"measured_target": 0, "previous_week": 0, "duplicate": 0}

    for _, host, rank, seed in queue:
        if time.time() - started > BUDGET_SECONDS:
            deferred[host] += 1
            continue
        expanded[host] += 1
        raw = []
        for q in [seed["query"]] + ([f"{seed['query']} {c}" for c in SUFFIX_LETTERS] if rank < SUFFIX_TOP_SEEDS else []):
            raw += [(c, "google_autocomplete") for c in src.autocomplete(q)]
        raw += [(c, "google_paa") for c in src.paa(seed["query"])]
        raw += [(c, "reddit") for c in src.reddit(seed["query"])]
        for cand, source in raw:
            n = norm(cand)
            if not n or n == norm(seed["query"]):
                continue
            if n in measured:
                dropped["measured_target"] += 1
                continue
            if n in prior:
                dropped["previous_week"] += 1
                continue
            if n in found[host]:
                dropped["duplicate"] += 1
                continue
            src.counts[source.removeprefix("google_")] += 1
            found[host][n] = {"query": cand.strip(), "seed": seed["query"], "seed_page": seed["page"],
                              "seed_impressions": seed["impressions"], "seed_position": seed["position"],
                              "source": source, "intent": intent_of(cand, seed["page"]), "intent_method": "rule",
                              "status": "unmeasured"}

    os.makedirs(os.path.join(out_root, week), exist_ok=True)
    for f in glob.glob(os.path.join(out_root, week, "*.json")):
        os.remove(f)
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    summary = []
    for s in sites:
        host = s["host"]
        cands = sorted(found[host].values(), key=lambda c: (-c["seed_impressions"], c["seed"], c["source"], c["query"]))
        qfp = {}
        for c in cands:
            if is_question(c["query"]):
                lst = qfp.setdefault(page_path(c["seed_page"]), [])
                if len(lst) < 20:
                    lst.append(c["query"])
        doc = {"schema_version": "1.0", "week": week, "property": host, "site": s["site"], "owner_repo": s.get("owner"),
               "generated_at": now, "rule": RULE, "seed_rule": "queries with >= 2 impressions in the report's 28-day window, top 40 by impressions",
               "window_28d": rep["windows"]["d28"], "sources": dict(src.state),
               "seeds": s["seeds"], "seeds_expanded": expanded[host], "seeds_deferred_budget": deferred[host],
               "candidate_count": len(cands), "candidates": cands, "questions_for_page": qfp}
        with open(os.path.join(out_root, week, f"{host}.json"), "w") as fh:
            json.dump(doc, fh, indent=2)
            fh.write("\n")
        summary.append({"property": host, "seeds": len(s["seeds"]), "expanded": expanded[host],
                        "candidates": len(cands), "questions_for_page": sum(len(v) for v in qfp.values())})

    snapshot = {"generated_at": now, "week": week,
                "rule": "Every query any portfolio repo already targets or Google already measured. No discovery candidate may be in it.",
                "sources": remote_sources + [{"source": "search_console_28d", "hosts": len(gsc.get("queries_by_host", {}))}],
                "query_count": len(measured), "queries": sorted(measured)}
    # Written twice: the top-level file is the latest dedupe set; the copy inside the
    # week's directory is the set THAT week's candidates were deduped against, which is
    # what the validator checks them with. Checking last week's candidates against this
    # week's set failed every Monday run on 12 Oct 2026: a candidate that Google started
    # measuring since (the outcome discovery exists for) read as a dedupe failure.
    for snap_path in (os.path.join(out_root, "measured_targets_snapshot.json"),
                      os.path.join(out_root, week, "measured_targets_snapshot.json")):
        with open(snap_path, "w") as fh:
            json.dump(snapshot, fh, indent=0)
            fh.write("\n")

    every = [c | {"property": h} for h in found for c in found[h].values()]
    # Top 10 by seed impressions, one per seed first (questions preferred) so one big seed
    # does not fill the table with its own autocomplete tail.
    ranked = sorted(every, key=lambda c: (-c["seed_impressions"], c["property"], c["seed"], not is_question(c["query"]),
                                          c["intent"] == "unclassified", c["query"]))
    firsts, seen_seeds = [], set()
    for c in ranked:
        if (c["property"], c["seed"]) not in seen_seeds:
            seen_seeds.add((c["property"], c["seed"]))
            firsts.append(c)
    top10 = (firsts + [c for c in ranked if c not in firsts])[:10]
    total = sum(x["candidates"] for x in summary)
    all_blocked = sum(src.counts.values()) == 0 and any(expanded.values())
    disc = {"week": week, "seed_count": sum(x["seeds"] for x in summary), "candidate_count": total,
            "properties_with_seeds": len(summary), "sources": dict(src.state), "candidates_by_source": dict(src.counts),
            "dropped": dropped, "dedupe_query_count": len(measured), "elapsed_seconds": round(time.time() - started),
            "receipt": receipt, "rule": RULE, "by_property": summary, "top10": top10,
            "files": f"data/discovery/{week}/",
            "named_stop": ("NAMED STOP: every free discovery source was unavailable this run (" +
                           "; ".join(f"{k}: {v}" for k, v in src.state.items()) + ")") if all_blocked and sites else None}
    rep["discovery"] = disc
    with open(report_path, "w") as fh:
        json.dump(rep, fh, indent=2)
        fh.write("\n")
    md_path = report_path[: -len(".json")] + ".md"
    md = open(md_path).read().split("\n## Discovery")[0].rstrip("\n")
    L = ["", "", "## Discovery (free, seeded from Search Console)", "",
         f"Discovery: {total} candidates for {disc['seed_count']} seeds across {len(summary)} properties. "
         f"Sources: " + "; ".join(f"{k} {v}" for k, v in src.state.items()) + ". "
         f"Paid calls: 0 (model calls {receipt['model_calls']}, cost ${receipt['cost_usd']}).", "",
         f"Rule: {RULE}", ""]
    if disc["named_stop"]:
        L += [disc["named_stop"], ""]
    L += ["| property | seeds | expanded | candidates | FAQ questions |", "|---|---|---|---|---|"]
    L += [f"| {x['property']} | {x['seeds']} | {x['expanded']} | {x['candidates']} | {x['questions_for_page']} |" for x in summary]
    L += ["", "Top 10 by seed impressions:", "", "| candidate | intent | source | seed (impr, pos) | property |", "|---|---|---|---|---|"]
    L += [f"| {c['query'].replace('|', '/')} | {c['intent']} | {c['source']} | {c['seed'].replace('|', '/')} "
          f"({c['seed_impressions']}, {c['seed_position']}) | {c['property']} |" for c in top10]
    with open(md_path, "w") as fh:
        fh.write(md + "\n".join(L) + "\n")
    print(f"discovery {week}: {total} candidates for {disc['seed_count']} seeds, {len(summary)} properties; "
          f"sources {src.state}; by source {src.counts}; dropped {dropped}; requests {receipt['requests_by_host']}; "
          f"{disc['elapsed_seconds']}s")


if __name__ == "__main__":
    main()
