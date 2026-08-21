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
archive="dist/madame-michu-${version}.xpi"
zip -q -r -FS "$archive" \
  manifest.json LICENSE PRIVACY.md background calendar llm utils ui icons experiments

sha256sum "$archive"
