#!/bin/bash
# Asistent engine on macOS: venv outside the vault + LaunchAgent that starts it at login.
# Safe to run again (updates the venv and reloads the agent).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP="$HOME/Library/Application Support/Asistent"
PLIST="$HOME/Library/LaunchAgents/com.contentstudio.asistent.plist"
mkdir -p "$APP/logs" "$HOME/Library/LaunchAgents"

PY=""
for c in /opt/homebrew/bin/python3.12 /usr/local/bin/python3.12 python3.12; do
  if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
[ -n "$PY" ] || { echo "Нужен е Python 3.12: brew install python@3.12"; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || [ -x /opt/homebrew/bin/ffmpeg ] || { echo "Нужен е FFmpeg: brew install ffmpeg"; exit 1; }

[ -x "$APP/venv/bin/python" ] || "$PY" -m venv "$APP/venv"
"$APP/venv/bin/pip" install -q --upgrade pip
"$APP/venv/bin/pip" install -q -r "$REPO/requirements.txt"
# speech recognition for subtitles (about 250 MB; the ~3 GB model is a separate download from the panel)
if [ "${1:-}" = "--subtitles" ]; then "$APP/venv/bin/pip" install -q -r "$REPO/requirements-asr.txt"; fi

# optional: word-timing alignment (torch, own environment, ~2 GB with the weights; CC-BY-NC weights, see LICENSES.md)
if [ "${1:-}" = "--align" ]; then
  [ -x "$APP/venv-align/bin/python" ] || "$PY" -m venv "$APP/venv-align"
  "$APP/venv-align/bin/pip" install -q --upgrade pip
  "$APP/venv-align/bin/pip" install -q -r "$REPO/requirements-align.txt"
  mkdir -p "$APP/models/torch"
  TORCH_HOME="$APP/models/torch" "$APP/venv-align/bin/python" -c "from torchaudio.pipelines import MMS_FA as b; b.get_model(); print('MMS_FA weights ready')"
fi

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.contentstudio.asistent</string>
  <key>ProgramArguments</key>
  <array>
    <string>$APP/venv/bin/python</string>
    <string>$REPO/engine/run_engine.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
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
    echo "Asistent engine работи (стартира се сам при вход)."; exit 0
  fi
  sleep 1
done
echo "Engine-ът не отговаря. Виж $APP/logs/"; exit 1
