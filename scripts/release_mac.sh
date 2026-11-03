#!/bin/bash
# After every change: pack the panel, install it into Premiere without any dialog (Adobe's own
# UnifiedPluginInstallerAgent), and restart the engine. A running Premiere loads the new panel live.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
UPIA="/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent"
[ -x "$UPIA" ] || { echo "No UnifiedPluginInstallerAgent (Creative Cloud): install the .ccx by double-clicking it."; exit 1; }

rm -f "$REPO"/dist/*.ccx
CCX="$("$REPO/scripts/package_ccx.sh")"
VER=$(python3 -c "import json;print(json.load(open('$REPO/panel/manifest.json'))['version'])")

# remove first, so an open Premiere unloads the old panel (it reports -406 but does unload), then install
"$UPIA" --remove "Asistent" >/dev/null 2>&1 || true
"$UPIA" --install "$CCX" | tail -1
if ! "$UPIA" --list all 2>/dev/null | grep -q "Asistent.*$VER"; then
  echo "Adobe does not report Asistent $VER as installed."; exit 1
fi
"$REPO/scripts/install_host_mac.sh"
"$REPO/scripts/setup_mac.sh" >/dev/null
echo "Asistent $VER is installed in Premiere, the engine was restarted."
