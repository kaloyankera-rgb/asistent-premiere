#!/bin/bash
# Asistent for Premiere Pro: the one-click installer for a Mac where nothing is set up (no Homebrew, no Python, no FFmpeg).
#
# 1. Python 3.12 and FFmpeg go into Asistent's own folder (~/Library/Application Support/Asistent), each download checked
#    by SHA-256 against the value pinned below. A Python 3.12 or FFmpeg from Homebrew is used instead when it is there.
# 2. The newest Asistent release comes from GitHub, checked against the SHA-256 in its latest.json (as the panel's updater).
# 3. That release's own installer (scripts/setup_mac.sh) does the rest: environment, engine, host, font, panel, LaunchAgent.
#
# No administrator password, nothing outside the user's own Library. Safe to run again. Later versions install from the
# panel's Update button. Built with installer/mac/build.sh, published as the "installer-mac" release (README).
set -uo pipefail

REPO="kaloyankera-rgb/asistent-premiere"
APP="$HOME/Library/Application Support/Asistent"
PLIST="$HOME/Library/LaunchAgents/com.contentstudio.asistent.plist"
LABEL="com.contentstudio.asistent"

# Pinned 2026-11-20. Python: astral-sh/python-build-standalone 20261026 (CPython 3.12.16, the "install_only" builds).
PY_BASE="https://github.com/astral-sh/python-build-standalone/releases/download/20261026"
PY_arm64="cpython-3.12.16+20261026-aarch64-apple-darwin-install_only.tar.gz fbf4afef53c2a6b72bb741bc06d5671a9dfaf87bd84e5aa73ac9b3d0d589f14e"
PY_x86_64="cpython-3.12.16+20261026-x86_64-apple-darwin-install_only.tar.gz a962e47df522889eaa7ff0d6a56203f1079f68aabb65ffdbe8455f362bc769f3"
# FFmpeg 9.0.2 (the version Asistent is developed with): ffmpeg.martin-riedl.de, static builds signed and notarized by Apple.
FF_BASE="https://ffmpeg.martin-riedl.de/download/macos"
FF_arm64="arm64/1789931890_9.0.2 c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924 fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6"
FF_x86_64="amd64/1789931006_9.0.2 7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4 2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd"

# Development only: ASISTENT_INSTALLER_TEST=1 ignores Homebrew's Python and FFmpeg (to try the downloads) and stops before
# step 4, which would replace the installed engine, panel and LaunchAgent. Run it with HOME pointed at a scratch folder.
TEST="${ASISTENT_INSTALLER_TEST:-0}"
HB=(/opt/homebrew/bin /usr/local/bin)
[ "$TEST" = "1" ] && HB=()

WORK="$(mktemp -d "${TMPDIR:-/tmp}/asistent-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

say()  { printf '\n  %s\n' "$*"; }
step() { printf '\n  [%s] %s\n' "$1" "$2"; }
finish() {
  echo
  read -n 1 -s -r -p "  Press any key to close this window."
  echo
  exit "$1"
}
fail() {
  say "Something went wrong: $*"
  say "Run the installer again (what is already done is kept). If it fails again, send a photo of this window"
  say "to the person who gave you Asistent."
  finish 1
}

# download URL to FILE and check its SHA-256; a file that does not match is deleted
fetch() {
  local url="$1" dest="$2" want="$3" got
  curl -fL --retry 3 --connect-timeout 20 --progress-bar -o "$dest.part" "$url" || return 1
  got="$(shasum -a 256 "$dest.part" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    rm -f "$dest.part"
    echo "  $(basename "$dest") does not match its checksum (got $got): not installed."
    return 1
  fi
  mv "$dest.part" "$dest"
}

clear
echo
echo "  Asistent for Premiere Pro: installer"
echo "  ===================================="
echo "  This takes 5 to 15 minutes and downloads about 600 MB. Keep this window open until it says Done."

# ------------------------------------------------------------------ checks
if [ "$(sysctl -in hw.optional.arm64 2>/dev/null)" = "1" ]; then ARCH=arm64; else ARCH=x86_64; fi

# The panel needs Premiere 26 (2026) or newer: without one, Adobe's plugin installer refuses it (status -411, a friend's
# Mac 2026-11-20) after the long part of the setup. Found by its app id through Spotlight (any folder), then Applications.
PREMIERE=""; FOUND=""
while IFS= read -r app; do
  case "$app" in *.app) ;; *) continue ;; esac
  case "$app" in /Applications/*) ;; *) continue ;; esac   # a copy elsewhere is not one Adobe installs into
  v="$(defaults read "$app/Contents/Info" CFBundleShortVersionString 2>/dev/null)" || continue
  FOUND="$FOUND    $(basename "$app" .app), version $v
"
  major="${v%%.*}"
  if [[ "$major" =~ ^[0-9]+$ ]] && [ "$major" -ge 26 ]; then PREMIERE="$app"; fi
done < <({ mdfind "kMDItemCFBundleIdentifier == 'com.adobe.PremierePro*'" 2>/dev/null
           ls -d /Applications/Adobe\ Premiere\ Pro*/*.app 2>/dev/null; } | sort -u)
if [ -z "$PREMIERE" ]; then
  if [ -n "$FOUND" ]; then
    say "Asistent needs Premiere Pro 2026 (version 26) or newer. This Mac has:"
    printf '%s' "$FOUND"
  else
    say "Asistent needs Premiere Pro 2026 (version 26) or newer, and no Premiere Pro was found on this Mac."
  fi
  say "Open the Creative Cloud app, install or update Premiere Pro to the newest version, then run this installer again."
  finish 1
fi
echo "  Premiere: $(basename "$PREMIERE" .app)"

if [ ! -d "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent" ]; then
  say "Adobe's plugin installer is missing. Open the Creative Cloud app once (it comes with Premiere), then run this again."
  finish 1
fi

free_gb=$(df -g "$HOME" | awk 'NR==2 {print $4}')
if [ -n "$free_gb" ] && [ "$free_gb" -lt 5 ]; then
  say "Only ${free_gb} GB free on this Mac. Asistent needs about 2 GB now and 3 GB more for the subtitles model."
  read -r -p "  Continue anyway? Type y and press Enter, or just press Enter to stop: " ans
  [ "$ans" = "y" ] || [ "$ans" = "Y" ] || finish 1
fi

mkdir -p "$APP" || fail "could not create $APP"

# ------------------------------------------------------------------ 1. Python 3.12
step 1/4 "Python"
PYBIN=""
for c in ${HB[@]+"${HB[@]/%//python3.12}"} "$APP/python/bin/python3.12"; do
  if [ -x "$c" ] && "$c" -c "import venv, ssl" >/dev/null 2>&1; then PYBIN="$c"; break; fi
done
if [ -n "$PYBIN" ]; then
  echo "  Already there: $PYBIN"
else
  eval "set -- \$PY_$ARCH"
  echo "  Downloading Python 3.12 ($ARCH)..."
  fetch "$PY_BASE/${1//+/%2B}" "$WORK/python.tar.gz" "$2" || fail "the Python download (check the internet connection)"
  rm -rf "$APP/python"
  tar -xzf "$WORK/python.tar.gz" -C "$APP" || fail "unpacking Python"
  PYBIN="$APP/python/bin/python3.12"
  "$PYBIN" -c "import venv, ssl" >/dev/null 2>&1 || fail "the downloaded Python does not start"
  echo "  Installed."
fi

# ------------------------------------------------------------------ 2. FFmpeg
step 2/4 "FFmpeg"
OWN_FFMPEG=0
HBFF=""
for b in ${HB[@]+"${HB[@]}"}; do [ -x "$b/ffmpeg" ] && [ -x "$b/ffprobe" ] && { HBFF="$b"; break; }; done
if [ -n "$HBFF" ]; then
  echo "  Already there: $HBFF/ffmpeg"
else
  OWN_FFMPEG=1
  if [ -x "$APP/ffmpeg/bin/ffmpeg" ] && [ -x "$APP/ffmpeg/bin/ffprobe" ] && "$APP/ffmpeg/bin/ffprobe" -version >/dev/null 2>&1; then
    echo "  Already there."
  else
    eval "set -- \$FF_$ARCH"
    mkdir -p "$APP/ffmpeg/bin"
    echo "  Downloading FFmpeg ($ARCH)..."
    fetch "$FF_BASE/$1/ffmpeg.zip" "$WORK/ffmpeg.zip" "$2" || fail "the FFmpeg download (check the internet connection)"
    fetch "$FF_BASE/$1/ffprobe.zip" "$WORK/ffprobe.zip" "$3" || fail "the FFprobe download (check the internet connection)"
    unzip -o -q "$WORK/ffmpeg.zip" -d "$APP/ffmpeg/bin" && unzip -o -q "$WORK/ffprobe.zip" -d "$APP/ffmpeg/bin" \
      || fail "unpacking FFmpeg"
    chmod +x "$APP/ffmpeg/bin/ffmpeg" "$APP/ffmpeg/bin/ffprobe"
    "$APP/ffmpeg/bin/ffprobe" -version >/dev/null 2>&1 || fail "the downloaded FFmpeg does not start"
    echo "  Installed."
  fi
fi

# ------------------------------------------------------------------ 3. the newest Asistent release
step 3/4 "Asistent"
curl -fsSL --retry 3 --connect-timeout 20 -o "$WORK/latest.json" "https://github.com/$REPO/releases/latest/download/latest.json" \
  || fail "could not reach GitHub (check the internet connection)"
read -r VER NAME SHA < <("$PYBIN" -I -c 'import json, sys
b = json.load(open(sys.argv[1]))
print(b["version"], b["bundle"]["name"], b["bundle"]["sha256"])' "$WORK/latest.json") || fail "reading latest.json"
[[ "$NAME" =~ ^Asistent-[0-9.]+\.zip$ ]] || fail "unexpected release file name: $NAME"
echo "  Downloading Asistent $VER..."
fetch "https://github.com/$REPO/releases/download/v$VER/$NAME" "$WORK/$NAME" "$SHA" || fail "the Asistent download (check the internet connection)"
mkdir -p "$WORK/release" && unzip -q "$WORK/$NAME" -d "$WORK/release" || fail "unpacking Asistent"
REL="$WORK/release/${NAME%.zip}"            # build_release.py packs everything under Asistent-<version>/
[ -f "$REL/scripts/setup_mac.sh" ] || REL="$WORK/release"
[ -f "$REL/scripts/setup_mac.sh" ] || fail "the release has no Mac installer"

if [ "$TEST" = "1" ]; then say "Test run: stopping before the setup. Release unpacked and checked: Asistent $VER."; exit 0; fi

# ------------------------------------------------------------------ 4. the release's own installer
step 4/4 "Installing (the longest part: Python packages, the Premiere panel, the engine)"
FLAGS=()
if [ "$ARCH" = "arm64" ]; then
  FLAGS+=(--subtitles)
else
  echo "  This is an Intel Mac: everything is installed except Subtitles (one of its parts exists only for Apple Silicon)."
fi
export PATH="$(dirname "$PYBIN"):$APP/ffmpeg/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
if ! bash "$REL/scripts/setup_mac.sh" ${FLAGS[@]+"${FLAGS[@]}"} 2>&1 | tee "$WORK/setup.log"; then
  if grep -q "status = -411" "$WORK/setup.log"; then
    say "Adobe's plugin installer found no Premiere Pro it can add the panel to (error -411)."
    say "Open the Creative Cloud app, update Premiere Pro to the newest version (2026 or newer), open Premiere once,"
    say "quit it, and run this installer again. Everything downloaded so far is kept."
    finish 1
  fi
  fail "the Asistent setup (see the lines above)"
fi

# The engine is started by a LaunchAgent whose PATH holds only the Homebrew folders: add Asistent's own FFmpeg to it and
# start the engine again so it reads the new PATH. (An Update keeps the LaunchAgent as it is.)
if [ "$OWN_FFMPEG" = "1" ]; then
  plutil -replace EnvironmentVariables.PATH -string "$APP/ffmpeg/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" "$PLIST" \
    || fail "could not add FFmpeg to the engine's settings"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  for i in $(seq 1 20); do   # bootout is asynchronous
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break
    sleep 0.5
  done
  launchctl bootstrap "gui/$(id -u)" "$PLIST" || fail "could not start the engine again"
  ok=0
  for i in $(seq 1 60); do
    if curl -s -H "X-Asistent: 1" http://127.0.0.1:47390/status | grep -q asistent; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = "1" ] || fail "the engine does not answer after the restart (logs: $APP/logs)"
fi

echo
echo "  Done. Asistent $VER is installed."
echo
echo "  1. If Premiere Pro is open, save your work and quit it completely (Cmd+Q). Then open it again."
echo "  2. In Premiere: Window > UXP Plugins > Asistent."
if [ "$ARCH" = "arm64" ]; then
  echo "  3. For subtitles: in Asistent's Subtitles card, press the button that downloads the speech model (about 3 GB) once."
fi
echo
echo "  New versions install from the Update button at the top of the panel. You do not need this installer again."
finish 0
