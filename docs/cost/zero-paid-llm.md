# Zero paid LLM (owner policy, 11 Oct 2026)

> "nothing should be paid … cut the probes and make them free."

## What was paid before

| Call site | Run by | How often | Model | What it did | Cost (estimated from list prices) |
|---|---|---|---|---|---|
| `scripts/queries/probe_query_class_occupancy.mjs` (`npm run probe:occupancy`) | `query-evidence-refresh.yml` (cron `23 6 * * *`) and dispatch `query-class-occupancy-probe.yml` | daily, 16 panel + 20 atlas-head queries ≈ 36 calls (+ retries) | `openai/gpt-4o-mini` + OpenRouter web plugin (`parallel`, 10 results) | read which hosts answer engines cite per query class; the atlas ranks release candidates by it | ~$0.0013 web + ~$0.0003 tokens per call ≈ **$0.06/day** |
| `scripts/llm_citation_probe.mjs` step "Observe whether answer engines cite us" | `query-evidence-refresh.yml` | daily, 25 queries | `openai/gpt-4o-mini` + web plugin (grounded) | recorded whether grounded answers cited our domains | ≈ **$0.04/day** |
| `scripts/community/adapters/google_paa_adapter.js` | nothing schedules it with a key | never (no `SERPAPI_API_KEY` in any workflow) | SerpAPI (paid search API) | People-also-ask questions | $0 (never wired) |

The run history proves real spend: 1,090 grounded observations, every recent run 25/25 answered with cited domains (`data/signals/llm_citation_observations.json`), and 218 occupancy readings.

## What it is now

- **Probes: off every schedule.** `query-evidence-refresh.yml` runs neither. Both are dispatch-only in `query-class-occupancy-probe.yml`, behind `confirm_paid` (boolean, default false; otherwise a `refuse` job prints a NAMED STOP and nothing runs).
- **Even a confirmed run is free.** All model calls go through `scripts/lib/free_llm_router.mjs` on the $0 models in `config/llm_routing.json`. The occupancy probe needs the billed web plugin, so it stops by name and writes nothing (the atlas keeps the last committed readings, stale, never zero). The citation probe runs in knowledge mode on $0 models.
- **SerpAPI adapter:** no longer calls SerpAPI at all; a live-signal run logs a named stop.
- **Router rules:** `max_cost_usd: 0`; only listed $0 models; no paid fallback; a reported non-zero `usage.cost` fails the run; no answer = named stop; a disabled or invalid key = named stop "OpenRouter key disabled or invalid; free routing needs an enabled key with a $0 limit".
- **Daily receipt:** `query-evidence-refresh.yml` runs `node scripts/lib/free_llm_router.mjs --ping` (one $0 call) and prints `LLM ROUTER RECEIPT`.
- **Guard:** folded into the `site-hygiene` blocker (no new blocker; the cap of 40 holds): `scripts/lib/zero_paid_llm_check.js`, registered in `data/seo/site_hygiene_registry.json#zero_paid_llm`, replays eight hostile fixtures every run.
- **Rewritten validator:** `validate_llm_citation_observation_integrity.js` (retired, kept correct) treats staleness as healthy while `policy.probes_scheduled` is false; its truncation checks still bind.
- **Refresh the free list:** `node scripts/lib/free_llm_router.mjs --refresh` (keyless). A snapshot older than 30 days is a warning.
