#!/bin/bash
# Asistent on macOS, from this folder (the repo or an unpacked release): Python environment, the files in
# ~/Library/Application Support/Asistent/current (the engine runs from there), the host, the font, the panel, and a
# LaunchAgent that starts the engine at login. Safe to run again. After the first install the panel updates itself.
#   scripts/setup_mac.sh [--subtitles] [--align] [--no-panel]
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Library/Application Support/Asistent"
PLIST="$HOME/Library/LaunchAgents/com.contentstudio.asistent.plist"
SUBTITLES=0; ALIGN=0; PANEL=1
for a in "$@"; do
  case "$a" in
    --subtitles) SUBTITLES=1 ;;
    --align) ALIGN=1 ;;
    --no-panel) PANEL=0 ;;
  esac
done
mkdir -p "$APP/logs" "$HOME/Library/LaunchAgents"

PY=""
for c in /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3.12; do
  if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
[ -n "$PY" ] || { echo "Python 3.12 is needed: brew install python@3.12"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || [ -x /opt/homebrew/bin/ffmpeg ] || { echo "FFmpeg is needed: brew install ffmpeg"; exit 1; }

[ -x "$APP/venv/bin/python" ] || "$PY" -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$SRC/requirements.txt"
# speech recognition for subtitles (about 250 MB; the ~3 GB model and the translator are downloads from the panel);
# an install that already has it keeps it up to date
if [ "$SUBTITLES" = "1" ] || "$APP/venv/bin/python" -c "import faster_whisper" >/dev/null 2>&1; then
  "$APP/venv/bin/pip" install -q -r "$SRC/requirements-asr.txt"
  # Bulgarian word list (LibreOffice dictionaries/bg_BG, GPL v2; see LICENSES.md): not part of the repository
  mkdir -p "$APP/models/lexicon"
  for f in bg_BG.dic bg_BG.aff COPYING; do
    [ -s "$APP/models/lexicon/$f" ] || curl -sSfL -o "$APP/models/lexicon/$f" "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/bg_BG/$f"
  done
fi

# optional: word-timing alignment (torch, own environment, ~2 GB with the weights; CC-BY-NC weights, see LICENSES.md)
if [ "$ALIGN" = "1" ]; then
  [ -x "$APP/venv-align/bin/python" ] || "$PY" -m venv "$APP/venv-align"
  "$APP/venv-align/bin/pip" install -q --upgrade pip
  "$APP/venv-align/bin/pip" install -q -r "$SRC/requirements-align.txt"
  mkdir -p "$APP/models/torch"
  TORCH_HOME="$APP/models/torch" "$APP/venv-align/bin/python" -c "from torchaudio.pipelines import MMS_FA as b; b.get_model(); print('MMS_FA weights ready')"
fi

# the files into $APP/current, the host into Premiere's CEP folder, the font, the panel (engine/asistent/install.py)
ARGS=(--src "$SRC")
[ "$PANEL" = "1" ] || ARGS+=(--no-panel)
PYTHONPATH="$SRC/engine" "$APP/venv/bin/python" -m asistent.install "${ARGS[@]}"

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.contentstudio.asistent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP/venv/bin/python</string>
    <string>$APP/current/engine/run_engine.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>2</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>LowPriorityIO</key><false/>
  <key>StandardErrorPath</key><string>$APP/logs/launchd.err</string>
</dict>
</plist>
PL

launchctl bootout "gui/$(id -u)/com.contentstudio.asistent" 2>/dev/null || true
for i in $(seq 1 20); do   # bootout is asynchronous
  launchctl print "gui/$(id -u)/com.contentstudio.asistent" >/dev/null 2>&1 || break
  sleep 0.5
done
launchctl bootstrap "gui/$(id -u)" "$PLIST"
# the first start compiles and loads SciPy, which can take ~20 s
for i in $(seq 1 40); do
  if curl -s -H "X-Asistent: 1" http://127.0.0.1:47390/status | grep -q asistent; then
    echo "Asistent engine is running (it starts by itself at login). Later versions install from the panel's Update button."; exit 0
  fi
  sleep 1
done
echo "The engine does not answer. See $APP/logs/"; exit 1
