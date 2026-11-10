#!/bin/bash
# Pack the panel as a .ccx (a zip with manifest.json at its root). Double-click installs it via Creative Cloud.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
VER=$(python3 -c "import json;print(json.load(open('$REPO/panel/manifest.json'))['version'])")
mkdir -p "$REPO/dist"
# the panel shows its own version in the header
printf '// written by scripts/package_ccx.sh\nmodule.exports = "%s";\n' "$VER" > "$REPO/panel/version.js"
OUT="$REPO/dist/Asistent-$VER.ccx"
rm -f "$OUT"
(cd "$REPO/panel" && zip -q -r -X "$OUT" manifest.json index.html style.css main.js engine.js store.js premiere.js layout.js premiere-audio.js audioplan.js channels.js premiere-import.js premiere-color.js premiere-probe.js moments.js colorplans.js subtitleplan.js reviewplan.js placementplan.js premiere-placement.js captionedit.js cssprobe.js premiere-subtitles.js captionplan.js premiere-captions.js roughcutplan.js premiere-roughcut.js devbridge.js exportevents.js keyframeplan.js premiere-keyframes.js keyframer.js tracknames.js premiere-labels.js version.js icons)
echo "$OUT"
