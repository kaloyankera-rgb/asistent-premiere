#!/bin/bash
# Pack the one-click Mac installer: dist/Asistent-Mac-Installer.zip with "Install Asistent.command" (executable bit kept,
# a browser download of a bare .command loses it) and "Read me first.txt".
# Publish (only when the user asks): the "installer-mac" pre-release, so the link below never changes and the updater's
# releases/latest is untouched; the installer itself always fetches the newest Asistent release.
#   gh release upload installer-mac dist/Asistent-Mac-Installer.zip --clobber
#   https://github.com/kaloyankera-rgb/asistent-premiere/releases/download/installer-mac/Asistent-Mac-Installer.zip
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/Asistent Installer" "$REPO/dist"
cp "$HERE/Install Asistent.command" "$HERE/Read me first.txt" "$STAGE/Asistent Installer/"
chmod 755 "$STAGE/Asistent Installer/Install Asistent.command"
rm -f "$REPO/dist/Asistent-Mac-Installer.zip"
(cd "$STAGE" && zip -q -X -r "$REPO/dist/Asistent-Mac-Installer.zip" "Asistent Installer")
echo "$REPO/dist/Asistent-Mac-Installer.zip"
