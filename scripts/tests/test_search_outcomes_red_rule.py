#!/usr/bin/env python3
"""Fixture test for the weekly search-outcome RED rule and coverage repo list.

No network, no secrets. Pins (search_outcomes_weekly.py, MATERIAL_DROP):
  - a one-week dip while the 28-day total rose is NOT RED (hicksconsulting.org,
    W43: 417 -> 266 week, 28-day 1,579 -> 1,643);
  - a real 28-day fall stays RED, from the 28 days before or from a recent
    report's 28-day figure (weddingbudgetspreadsheet.com: 57 -> 23, 55 in W42);
  - any material 28-day fall goes RED, and a week drop with the 28-day also
    falling goes RED; small samples and noise-sized drops do not;
  - every repo named as an owner is read for coverage files (hicks was not).
"""
import json
import os
import sys
import tempfile

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "search_console"))
import search_outcomes_weekly as w  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
errors = []
NOCOV = {"share_now": None, "share_prior": None}


def m(cur, pri, d28, d28p, clicks=0, peak=None):
    out = {"current": {"impressions": cur, "clicks": clicks}, "prior": {"impressions": pri, "clicks": 0},
           "d28": {"impressions": d28}, "d28_prior": {"impressions": d28p}, "url_status": {}}
    if peak:
        out["d28_recent_peak"] = {"impressions": peak[0], "week": peak[1]}
    return out


def expect(name, metrics, want, contains=None):
    v, why = w.verdict(metrics, NOCOV)
    if v != want:
        errors.append(f"{name}: expected {want}, got {v} ({why})")
    elif contains and contains not in why:
        errors.append(f"{name}: reason should mention {contains!r}: {why}")


# Noise: hicks W43 must not be RED.
expect("hicks one-week dip, 28-day rose", m(266, 417, 1643, 1579, clicks=8, peak=(1643, "2026-W43")), "WATCH", "one-week dip")
# Real decline: wedding budget stays RED whichever baseline carries it.
expect("wedding budget vs 28 days before", m(0, 0, 23, 57), "RED", "28-day impressions down")
expect("wedding budget vs W42 figure", m(0, 0, 23, 33, peak=(55, "2026-W42")), "RED", "2026-W42")
# Strengthened, not weakened: a material 28-day fall is RED even with a flat week.
expect("28-day fall, flat week", m(100, 100, 300, 500, clicks=3), "RED", "28-day")
expect("week drop with 28-day falling", m(40, 100, 490, 500), "RED", "28-day also down")
expect("week drop, no 28-day comparison", {**m(40, 100, None, None), "d28": {}, "d28_prior": {}}, "RED", "no 28-day comparison")
# Minimum sample and noise.
expect("small site 30 -> 15 over 28 days", m(2, 6, 15, 30), "WATCH")
expect("noise-sized 28-day fall 40 -> 30", m(8, 9, 30, 40), "WATCH")
expect("week drop below the 50 floor", m(10, 45, 190, 200), "WATCH")
expect("week drop on a rising 28-day", m(60, 100, 520, 500), "WATCH", "one-week dip")
# Other RED causes untouched.
expect("dead URL", {**m(100, 100, 400, 400), "url_status": {"https://x.example/a": 404}}, "RED", "404/410")
expect("read failure", {"error": "boom"}, "RED", "read failed")
if not w.material_drop(57, 23, w.D28_MIN_PRIOR) or w.material_drop(40, 30, w.D28_MIN_PRIOR):
    errors.append("material_drop must flag 57 -> 23 and not 40 -> 30")

# Recent 28-day peaks come from committed reports before this week, newest D28_LOOKBACK_REPORTS only.
with tempfile.TemporaryDirectory() as d:
    for wk, imp in (("2026-W38", 999), ("2026-W40", 50), ("2026-W41", 70), ("2026-W42", 55), ("2026-W43", 40), ("2026-W44", 500)):
        with open(os.path.join(d, f"{wk}.json"), "w") as fh:
            json.dump({"sites": [{"host": "a.example", "d28": {"impressions": imp}}]}, fh)
    peaks = w.recent_d28_peaks(d, "2026-W44")
    if peaks.get("a.example") != (70, "2026-W41"):
        errors.append(f"recent_d28_peaks must use the 4 reports before this week only: {peaks}")
real = w.recent_d28_peaks(os.path.join(ROOT, "reports", "search_outcomes"), "2026-W44")
if real.get("weddingbudgetspreadsheet.com", (0,))[0] < 55:
    errors.append(f"committed reports must give weddingbudgetspreadsheet.com a recent 28-day peak >= 55: {real.get('weddingbudgetspreadsheet.com')}")

# One owner list: every repo named in FALLBACK_OWNER / EXPECTED_PROPERTIES is read for coverage files.
for repo in set(w.FALLBACK_OWNER.values()) | set(w.EXPECTED_PROPERTIES.values()):
    if repo not in w.COVERAGE_REPOS:
        errors.append(f"{repo} owns a property but is not in COVERAGE_REPOS")
if "hicks-consulting-canonical" not in w.COVERAGE_REPOS:
    errors.append("hicks-consulting-canonical (commits index_coverage.json daily) is missing from COVERAGE_REPOS")
if len(w.COVERAGE_REPOS) != len(set(w.COVERAGE_REPOS)):
    errors.append("COVERAGE_REPOS has duplicates")
if "d28_prior" not in w.windows(__import__("datetime").date(2026, 10, 26)):
    errors.append("windows() must include d28_prior")

if errors:
    print("FAIL test_search_outcomes_red_rule\n- " + "\n- ".join(errors), file=sys.stderr)
    sys.exit(1)
print("PASS test_search_outcomes_red_rule")
