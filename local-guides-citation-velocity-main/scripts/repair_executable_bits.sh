#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ruby -rjson -e 'payload=JSON.parse(File.read("content/_shared/executable_files.json")); (payload["files"]||[]).each { |rel| if File.exist?(rel); File.chmod(0755, rel); puts "chmod 755 #{rel}"; end }'
