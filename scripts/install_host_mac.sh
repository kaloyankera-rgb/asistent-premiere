#!/bin/bash
# Installs the Asistent host (host/) as a CEP extension: the invisible background extension that puts an SRT on a
# caption track, which the UXP panel cannot do. CEP loads unsigned extensions only with PlayerDebugMode=1 (it is set for
# CSXS 10-13 here, the same switch Quick Search needs). Premiere reads the extension list when it starts: the first
# install needs one Premiere restart; later changes to host.jsx/main.js apply without it (host.jsx is read per command).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.contentstudio.asistent.host"
NEW=0
[ -d "$DEST" ] || NEW=1
mkdir -p "$DEST"
rsync -a --delete "$REPO/host/" "$DEST/"
for v in 10 11 12 13; do
  [ "$(defaults read com.adobe.CSXS.$v PlayerDebugMode 2>/dev/null || echo 0)" = "1" ] || defaults write com.adobe.CSXS.$v PlayerDebugMode 1
done
if [ "$NEW" = "1" ]; then
  echo "Asistent host е инсталиран. Затвори и отвори Premiere веднъж, за да го зареди."
else
  echo "Asistent host е обновен."
fi
