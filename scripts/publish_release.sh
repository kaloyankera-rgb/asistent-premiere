#!/bin/bash
# Publish the current version as a GitHub release (tag v<version>): every installed Asistent offers it in its panel.
# Only when the user asks, after the version is committed and pushed. A version is published once; never moved.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
VER=$(python3 -c "import json;print(json.load(open('panel/manifest.json'))['version'])")
[ -z "$(git status --porcelain -- . ':!references')" ] || { echo "Commit first: the release must be exactly a commit."; exit 1; }
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Push first: GitHub's main must be this commit."; exit 1; }
if gh release view "v$VER" >/dev/null 2>&1; then echo "v$VER is already published."; exit 1; fi
python3 scripts/build_release.py >/dev/null
gh release create "v$VER" "dist/Asistent-$VER.zip" dist/latest.json --target "$(git rev-parse HEAD)" \
  --title "Asistent $VER" --notes-file dist/notes.md --latest
echo "Published Asistent $VER: installed panels offer it within a few hours (or at their next start)."
