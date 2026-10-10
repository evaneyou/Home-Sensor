#!/usr/bin/env bash
# Set the project version in VERSION, server/pyproject.toml and dashboard/package.json.
# Usage: ./scripts/bump-version.sh 0.2.0
set -euo pipefail

if [[ $# -ne 1 ]] || ! [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
  echo "Usage: $0 MAJOR.MINOR.PATCH   (for example 0.2.0 or 1.0.0-rc.1)" >&2
  exit 1
fi

version="$1"
cd "$(dirname "$0")/.."

printf '%s\n' "$version" > VERSION

sed -i -E '0,/^version = ".*"$/s//version = "'"$version"'"/' server/pyproject.toml

(cd dashboard && npm version "$version" --no-git-tag-version --allow-same-version >/dev/null)

if command -v uv >/dev/null 2>&1; then
  (cd server && uv lock --quiet)
fi

echo "Version set to $version in VERSION, server/pyproject.toml, dashboard/package.json."
echo "Next: update CHANGELOG.md, commit, then: git tag v$version"
