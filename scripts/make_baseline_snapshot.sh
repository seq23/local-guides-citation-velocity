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
  --skip-validate        Skip npm run validate:all.
  --out-dir PATH         Output directory for the ZIP. Default: parent directory of repo root.
  --repo-name NAME       Repo name used in ZIP filename. Default: current directory name.
  --sha VALUE            Override filename SHA. Default: git short SHA if available, else content hash.
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
  echo "Running npm run validate:all..."
  npm run validate:all
else
  echo "Skipping validate:all."
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

if [[ -n "$SHA_OVERRIDE" ]]; then
  SHA="$SHA_OVERRIDE"
elif git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SHA="$(git rev-parse --short=7 HEAD)"
else
  # Fast fallback for ZIP-delivered repos without .git. This is not a commit hash; it is a deterministic
  # packaging fingerprint from source-of-truth root/script files so snapshot creation does not traverse
  # thousands of generated pages just to name the archive.
  SHA="$(sha256sum package.json README.md .gitignore scripts/make_baseline_snapshot.sh content/_shared/executable_files.json 2>/dev/null | sha256sum | cut -c1-7)"
fi

DATE="$(date +%m-%d-%y)"
ZIP_REPO_NAME="${REPO_NAME%-main}"
ZIP_NAME="${ZIP_REPO_NAME}-main_BASELINE_${DATE}_${SHA}.zip"
ZIP_PATH="$OUT_DIR/$ZIP_NAME"
rm -f "$ZIP_PATH"

EXCLUDES=(
  "*/node_modules/*"
  "*/.DS_Store"
  "*/.cache/*"
  "*/tmp/*"
  "*/logs/*"
  "*.zip"
)

if [[ "$INCLUDE_GIT" == "0" ]]; then
  EXCLUDES+=("*/.git/*")
  echo "Packaging with .git excluded. Use --include-git to include Git history."
else
  echo "Packaging with .git included if present."
fi

PARENT="$(dirname "$ROOT")"
BASE="$(basename "$ROOT")"
if [[ "$INCLUDE_GIT" == "1" ]]; then
  ruby scripts/create_store_zip.rb "$ROOT" "$ZIP_PATH" --include-git
else
  ruby scripts/create_store_zip.rb "$ROOT" "$ZIP_PATH"
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
