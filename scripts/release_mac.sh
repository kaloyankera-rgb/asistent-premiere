#!/bin/bash
# After every change, on the development Mac: pack the panel and install everything from this repo (the files into
# ~/Library/Application Support/Asistent/current, the host, the panel through Adobe's UnifiedPluginInstallerAgent with
# no dialog, the engine restarted). A running Premiere loads the new panel live. Publishing for other computers is
# scripts/publish_release.sh (only when the user asks).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
rm -f "$REPO"/dist/*.ccx
"$REPO/scripts/package_ccx.sh" >/dev/null
VER=$(python3 -c "import json;print(json.load(open('$REPO/panel/manifest.json'))['version'])")
"$REPO/scripts/setup_mac.sh" | grep -v "^Asistent engine is running" || true
curl -s -H "X-Asistent: 1" http://127.0.0.1:47390/status | grep -q "\"version\": \"$VER\"" || { echo "The engine does not answer with $VER."; exit 1; }
echo "Asistent $VER is installed in Premiere, the engine was restarted."
