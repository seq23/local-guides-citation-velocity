# Backlink Disavow Package

Audit date: 2026-11-19
Source: Semrush backlink analysis

## Summary of findings

### theindustryguides.com
- **Authority Score: 2/100** | 7 backlinks from 7 domains, all nofollow
- **All 7 referring domains are spam.** Smoking-gun anchor text:
  *"thanks to fiverr's pbn links, our theindustryguides.com saw a DR increase from 20 to 45"*
- Someone (or a former vendor) bought Fiverr PBN links pointed at the site.
- **Risk: Low-to-moderate.** All links are nofollow so Google likely already ignores them,
  but disavowing removes any ambiguity and protects the brand-new domain from manual review.

### aplayermode.com + billionairehighperformancecoach.com
- **aplayermode.com:** AS 2/100, 192 backlinks from 24 domains, 171 follow
- **billionairehighperformancecoach.com:** AS 2/100, 398 backlinks from 35 domains, 312 follow
- **These two share the same toxic backlink network.** Multiple smoking-gun anchors:
  - *"after trying fiverr for links, my {aplayermode.com} dr soared from 20 to 55"*
  - *"fiverr's guest posts lifted {aplayermode.com} da from 25 to 60"*
- 14 spam domains identified across 3 patterns:
  1. **Fiverr PBN network** (5 domains: `fiverr-*-seo-*.site`)
  2. **SEO spam .shop network** (3 domains: `seo-*-hub.shop`, `seopxl-*.shop`)
  3. **Generic spam TLDs** (6 domains: `.top`, `.cloud`, `.website`, `.wiki`)
- **Risk: HIGH.** These are follow links from an obvious link scheme. This is the exact
  pattern Google's SpamBrain targets and can trigger a manual action.

### What's NOT in the disavow (intentional)
| Domain | Why excluded |
|---|---|
| spryexecutiveos.com | Your own property — 264 self-links. Audit internally; don't disavow. |
| billionairehighperformancecoach.com (self) | Self-references. Don't disavow. |
| bye.fyi | Legit URL shortener (AS 25). Keep. |
| backlinks-checker.com | Tool that auto-crawls; nofollow; harmless. Kept (you can add later if you want zero risk). |

## What to do (5 minutes per property)

1. Open Google Search Console: https://search.google.com/search-console
2. Verify each property is added (theindustryguides.com, aplayermode.com,
   billionairehighperformancecoach.com). Domain-property verification is best.
3. Go to the Disavow Links tool: https://search.google.com/search-console/disavow-links
4. Select the property from the dropdown.
5. Upload the matching .txt file:
   - For **theindustryguides.com** → upload `theindustryguides.com-disavow.txt`
   - For **aplayermode.com** → upload `aplayermode-billionaire-disavow.txt`
   - For **billionairehighperformancecoach.com** → upload the SAME
     `aplayermode-billionaire-disavow.txt` (each property needs its own upload)
6. Confirm. Google takes a few weeks to reprocess.

## After disavowing — fix the upstream cause

1. **Stop buying Fiverr/PBN links.** Permanently. Even one more order undoes this.
2. **Re-audit in 90 days** — new spam may appear if a competitor negative-SEOs you.
3. **Earn real links:** the GEO/citation strategy we built (programmatic guides,
   data tables, methodology page) is the legitimate path forward.
4. For the **aplayermode/billionaire** sites: with AS 2 and a poisoned profile,
   seriously consider whether to keep them or sunset/301 to a cleaner domain.

## File manifest
- `README.md` — this file
- `theindustryguides.com-disavow.txt` — 7 domains
- `aplayermode-billionaire-disavow.txt` — 14 domains (use for both properties)
