# ENVIRONMENT AND SECRETS GUIDE

This repo is primarily a static Node publishing system. Core build and structural validation do not require application user credentials.

## Local requirements

- Node version from `.nvmrc` / `package.json` engine.
- npm with the committed lockfile.
- Standard shell tools used by snapshot scripts: `bash`, `zip/unzip`, `sha256sum` (or platform equivalent), and Ruby for the store-ZIP helper.

## External/provider operations

Distribution/indexing scripts may require provider-specific credentials or configuration. Those credentials are outside this artifact and must never be committed into the repo or packaged ZIP.

No live provider/account mutation was performed as part of this artifact.
