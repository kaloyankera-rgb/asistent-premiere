#!/bin/bash
# Double-click once to install Asistent on a Mac (needs Python 3.12 and FFmpeg from Homebrew, see README). Later versions
# install from the panel's Update button. Works from the top of the release folder and from scripts/.
D="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$D/setup_mac.sh" ]; then S="$D/setup_mac.sh"; else S="$D/scripts/setup_mac.sh"; fi
chmod +x "$S"
"$S" --subtitles
echo
read -n 1 -s -r -p "Press any key to close this window."
