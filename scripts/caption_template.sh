#!/bin/bash
# Builds Asistent's subtitle templates with After Effects (scripts/caption_template.jsx) into the app data folder.
# Opens After Effects if it is not running; refuses when it has unsaved work. Prints the report it wrote.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$HOME/Library/Application Support/Asistent/templates"
AE="$(ls -d /Applications/Adobe\ After\ Effects\ 20* 2>/dev/null | sort | tail -1)"
[ -n "$AE" ] || { echo "After Effects is not installed." >&2; exit 1; }
APP="$(basename "$AE")"
mkdir -p "$OUT"
rm -f "$OUT/caption_template.json"
RUN="$OUT/run_caption_template.jsx"
{ printf 'var OUT_DIR = "%s";\n' "$OUT"; cat "$REPO/scripts/caption_template.jsx"; } > "$RUN"
osascript -e "tell application \"$APP\" to DoScriptFile \"$RUN\"" >/dev/null
for _ in $(seq 1 120); do [ -f "$OUT/caption_template.json" ] && break; sleep 1; done
cat "$OUT/caption_template.json" 2>/dev/null || { echo "No report from After Effects (is 'Allow Scripts to Write Files' on in its Scripting preferences?)." >&2; exit 1; }
