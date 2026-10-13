#!/usr/bin/env python3
"""Fixture test for the search -> leads row in search_outcomes_weekly.py.

Runs with no network and no secrets: the funnel fetch is given a fixture
response shaped like GET /api/senior-funnel (local-guides-generator,
lib/senior/funnel.mjs). Proves: the row line, no token, unavailable (HTTP error,
bad JSON, exception), and the RED rule (>= 20 clicks with 0 intake starts),
which must not fire on unavailable data.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "search_console"))
import search_outcomes_weekly as w  # noqa: E402

HOST = "memphisseniorcarehomes.com"
FIXTURE = {"ok": True, "window": {"days": 7}, "intake_starts": 9, "results_shown": 7, "screens": {"1": 9},
           "contact_submitted": 5, "unsellable": 1, "unsellable_reasons": {"out_of_area": 1}, "teasers_sent": 4,
           "accepts_flat": 2, "accepts_rent": 1, "accepts_late": 0, "releases": 3, "passes": {},
           "followup_outcomes": {"moved_in": 1, "not_yet": 0, "elsewhere": 0}, "seat": {"active": True},
           "leads_by_page": [{"page_kind": "velocity", "page_slug": "private-pay-vs-medicaid-beds-memphis", "leads": 2},
                             {"page_kind": "city", "page_slug": "germantown-tn", "leads": 3}],
           "leads_by_src": {}}


def fetcher(status, body):
    def f(url, method, body_, headers, timeout):
        assert headers.get("x-senior-tick-token") == "t0k", "token must go in x-senior-tick-token"
        assert url.endswith("/api/senior-funnel?days=7")
        if isinstance(body, Exception):
            raise body
        return status, body if isinstance(body, bytes) else json.dumps(body).encode()
    return f


def main():
    os.environ.pop(w.FUNNEL_TOKEN_ENV, None)
    assert w.fetch_funnel(HOST) == {"status": "no_token"}
    assert w.fetch_funnel("theindustryguides.com") is None
    os.environ[w.FUNNEL_TOKEN_ENV] = "t0k"
    fun = w.fetch_funnel(HOST, fetch=fetcher(200, FIXTURE))
    assert fun["status"] == "ok" and fun["intake_starts"] == 9 and fun["leads"] == 5 and fun["moved_in"] == 1
    assert fun["top_sources"][0] == {"page_slug": "germantown-tn", "leads": 3}
    row = {"host": HOST, "current": {"impressions": 410, "clicks": 31}, "funnel": fun}
    line = w.funnel_line(row)
    for part in ["impressions 410", "clicks 31", "intake starts 9", "leads 5", "unsellable 1", "teasers 4",
                 "accepts 2 flat / 1 rent", "releases 3", "moved-in 1", "top lead sources: germantown-tn (3)"]:
        assert part in line, (part, line)
    for status, body in [(401, {"ok": False}), (200, b"not json"), (200, OSError("boom")), (500, FIXTURE)]:
        bad = w.fetch_funnel(HOST, fetch=fetcher(status, body))
        assert bad["status"] == "unavailable", bad
        assert w.funnel_line({"funnel": bad}) == "funnel: unavailable"
        assert w.funnel_verdict({"current": {"clicks": 99}}, bad, "GREEN", "x") == ("GREEN", "x")
    assert w.funnel_line({"funnel": {"status": "no_token"}}).startswith("funnel: no token")
    zero = dict(fun, intake_starts=0)
    v, why = w.funnel_verdict({"current": {"clicks": 20}}, zero, "GREEN", "x")
    assert v == "RED" and "0 intake starts" in why
    assert w.funnel_verdict({"current": {"clicks": 19}}, zero, "WATCH", "y") == ("WATCH", "y")
    assert w.funnel_verdict({"current": {"clicks": 50}}, fun, "WATCH", "y") == ("WATCH", "y")
    print("senior funnel row: 13 fixture checks pass")


if __name__ == "__main__":
    main()
