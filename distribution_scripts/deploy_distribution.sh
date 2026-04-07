#!/usr/bin/env bash
set -euo pipefail

HOST="${1:?Missing host}"
INDEXNOW_KEY="${2:?Missing IndexNow key}"
GSC_CREDS="${3:?Missing service account json path}"
GSC_SITE="${4:?Missing GSC siteUrl, e.g. sc-domain:example.com}"

python3 distribution_scripts/gsc_submit_sitemaps.py \
  "$GSC_CREDS" \
  "$GSC_SITE" \
  "https://$HOST/sitemap.xml"

echo
./distribution_scripts/indexnow_submit.sh \
  "$HOST" \
  "$INDEXNOW_KEY" \
  ".build/indexnow-priority.txt"

echo
./distribution_scripts/indexnow_submit.sh \
  "$HOST" \
  "$INDEXNOW_KEY" \
  ".build/indexnow-batch.txt"

echo
python3 distribution_scripts/gsc_inspect_urls.py \
  "$GSC_CREDS" \
  "$GSC_SITE" \
  ".build/distribution-priority-urls.txt" \
  ".build/inspection-results.json"

echo "DONE"
echo "Next: manually request indexing for 5-10 URLs in GSC UI"
