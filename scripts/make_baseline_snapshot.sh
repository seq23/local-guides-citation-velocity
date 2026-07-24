#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/make_baseline_snapshot.sh [options]

Creates a validated baseline snapshot ZIP from the repository root.

Options:
  --include-git          Include .git/ in the ZIP if present. Default excludes .git/.
  --skip-install         Skip npm ci.
  --skip-build           Skip npm run build.
  --skip-validate        Skip npm run validate:release (used when validation is delegated to the local updater).
  --out-dir PATH         Output directory for the ZIP. Default: parent directory of repo root.
  --repo-name NAME       Repo name used in ZIP filename. Default: current directory name.
  --sha VALUE            Deprecated compatibility option. Final filename always uses the first 12 chars of the finished ZIP SHA256.
  -h, --help             Show this help.

The ZIP always includes .github/workflows/ when present. It excludes only local junk/cache/output artifacts
unless --include-git is passed.
USAGE
}

INCLUDE_GIT=0
SKIP_INSTALL=0
SKIP_BUILD=0
SKIP_VALIDATE=0
OUT_DIR=""
REPO_NAME=""
SHA_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-git) INCLUDE_GIT=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --skip-validate) SKIP_VALIDATE=1; shift ;;
    --out-dir) OUT_DIR="${2:-}"; shift 2 ;;
    --repo-name) REPO_NAME="${2:-}"; shift 2 ;;
    --sha) SHA_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

REPO_NAME="${REPO_NAME:-$(basename "$ROOT") }"
REPO_NAME="${REPO_NAME% }"
OUT_DIR="${OUT_DIR:-$(dirname "$ROOT") }"
OUT_DIR="${OUT_DIR% }"
mkdir -p "$OUT_DIR"

require_file() {
  if [[ ! -f "$1" ]]; then
    echo "Snapshot refused: required root file missing: $1" >&2
    exit 1
  fi
}

require_file package.json
require_file README.md
require_file .gitignore

if [[ -d .github/workflows ]]; then
  WORKFLOW_COUNT="$(find .github/workflows -type f | wc -l | tr -d ' ')"
  if [[ "$WORKFLOW_COUNT" == "0" ]]; then
    echo "Snapshot refused: .github/workflows exists but contains no workflow files" >&2
    exit 1
  fi
  echo "Workflow files detected and will be included: $WORKFLOW_COUNT"
else
  echo "No .github/workflows directory found; continuing."
fi

repair_exec_bits() {
  if [[ -f scripts/repair_executable_bits.sh ]]; then
    chmod +x scripts/repair_executable_bits.sh || true
    bash scripts/repair_executable_bits.sh
  fi

}

echo "Repairing executable bits..."
repair_exec_bits

if [[ "$SKIP_INSTALL" == "0" && -f package-lock.json ]]; then
  echo "Running npm ci..."
  npm ci
else
  echo "Skipping npm ci."
fi

if [[ "$SKIP_BUILD" == "0" ]]; then
  echo "Running npm run build..."
  npm run build
else
  echo "Skipping build."
fi

if [[ "$SKIP_VALIDATE" == "0" ]]; then
  echo "Running npm run validate:release..."
  npm run validate:release
else
  echo "Skipping validate:release (local updater authority)."
fi

echo "Verifying LKG updater completeness artifacts..."
if [[ ! -d dist ]]; then
  echo "Snapshot refused: required updater directory missing: dist/" >&2
  exit 1
fi
for coverage_file in coverage_targets.csv coverage_runtime_support.csv coverage_promoted.csv; do
  if [[ ! -f "$coverage_file" && -f "data/$coverage_file" ]]; then
    cp "data/$coverage_file" "$coverage_file"
  fi
  require_file "$coverage_file"
done
require_file data/site.json

echo "Building release-critical artifact manifest..."
SOURCE_DATE="${SOURCE_DATE:-$(date +%F)}" node scripts/validators/build_artifact_validation_manifest.js

DATE="$(date +%m-%d-%y)"
ZIP_REPO_NAME="${REPO_NAME%-main}"
TMP_ZIP="$OUT_DIR/.${ZIP_REPO_NAME}-main_BASELINE_${DATE}_pending_$$.zip"
rm -f "$TMP_ZIP" "$TMP_ZIP.verification.json"

if [[ "$INCLUDE_GIT" == "0" ]]; then
  echo "Packaging with .git excluded. Use --include-git to include Git history."
else
  echo "Packaging with .git included if present."
fi

BASE="$(basename "$ROOT")"
if [[ "$INCLUDE_GIT" == "1" ]]; then
  ruby scripts/create_store_zip.rb "$ROOT" "$TMP_ZIP" --include-git
else
  ruby scripts/create_store_zip.rb "$ROOT" "$TMP_ZIP"
fi

echo "Reopening and verifying temporary ZIP bytes..."
node scripts/verify_baseline_snapshot.js "$TMP_ZIP"
ZIP_SHA256="$(sha256sum "$TMP_ZIP" | awk '{print $1}')"
SHORT_SHA="${ZIP_SHA256:0:12}"
if [[ -n "$SHA_OVERRIDE" && "$SHA_OVERRIDE" != "$SHORT_SHA" ]]; then
  echo "Ignoring deprecated --sha=$SHA_OVERRIDE; finished ZIP SHA256 requires $SHORT_SHA" >&2
fi
ZIP_NAME="${ZIP_REPO_NAME}-main_BASELINE_${DATE}_${SHORT_SHA}.zip"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"
rm -f "$ZIP_PATH" "$ZIP_PATH.verification.json"
mv "$TMP_ZIP" "$ZIP_PATH"
rm -f "$TMP_ZIP.verification.json"

echo "Verifying final named ZIP..."
node scripts/verify_baseline_snapshot.js "$ZIP_PATH"
FINAL_SHA256="$(sha256sum "$ZIP_PATH" | awk '{print $1}')"
if [[ "$FINAL_SHA256" != "$ZIP_SHA256" ]]; then
  echo "Snapshot refused: ZIP SHA changed after rename" >&2
  exit 1
fi

echo "Verifying ZIP root and workflow inclusion..."
ZIP_LIST_FILE="$(mktemp)"
trap 'rm -f "$ZIP_LIST_FILE"' EXIT
unzip -Z1 "$ZIP_PATH" > "$ZIP_LIST_FILE"
ZIP_ROOTS="$(awk -F/ 'NF {print $1}' "$ZIP_LIST_FILE" | sort -u | tr '\n' ' ')"
if [[ "$ZIP_ROOTS" != "$BASE " && "$ZIP_ROOTS" != "$BASE" ]]; then
  echo "Snapshot refused: ZIP has unexpected root entries: $ZIP_ROOTS" >&2
  exit 1
fi

if [[ -d .github/workflows ]]; then
  if ! grep -q "^$BASE/.github/workflows/" "$ZIP_LIST_FILE"; then
    echo "Snapshot refused: .github/workflows files missing from ZIP" >&2
    exit 1
  fi
fi

if [[ "$INCLUDE_GIT" == "0" ]]; then
  if grep -q "^$BASE/.git/" "$ZIP_LIST_FILE"; then
    echo "Snapshot refused: .git present despite default exclusion" >&2
    exit 1
  fi
fi

SIZE="$(du -h "$ZIP_PATH" | awk '{print $1}')"
echo "Baseline snapshot created: $ZIP_PATH ($SIZE)"
echo "SHA256: $FINAL_SHA256"
