// Google "People also ask" via SerpAPI - a PAID search API. Owner policy
// 11 Oct 2026 ("nothing should be paid"): this adapter never calls it. It had no
// key wired in any workflow (never spent); it now cannot spend even with one.
// scripts/lib/zero_paid_llm_check.js fails the build if a paid endpoint returns here.
async function collect(source) {
  if (process.env.COLLECT_LIVE_SIGNALS === '1') {
    console.warn(`[google_paa_adapter] NAMED STOP - ${source.source_key}: SerpAPI is a paid API, disabled by owner policy (11 Oct 2026). No signals collected, nothing spent.`);
  }
  return [];
}
module.exports = { collect };
