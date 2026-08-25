#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

version="$(node -p "require('./manifest.json').version")"
if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version de manifeste invalide : $version" >&2
  exit 1
fi

mkdir -p dist
archive="dist/madame-michu-${version}-source.zip"
zip -q -r -FS "$archive" \
  .gitignore LICENSE PRIVACY.md README.md ARCHITECTURE.md CONTRIBUTING.md RELEASE.md SOURCE_BUILD.md \
  manifest.json package.json artwork background calendar experiments icons llm \
  tests tools ui utils

sha256sum "$archive"
