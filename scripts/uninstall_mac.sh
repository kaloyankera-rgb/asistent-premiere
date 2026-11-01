#!/bin/bash
# Stop the engine and remove the LaunchAgent. The venv and logs stay in ~/Library/Application Support/Asistent.
launchctl bootout "gui/$(id -u)/com.contentstudio.asistent" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.contentstudio.asistent.plist"
echo "Asistent engine е спрян и няма да се стартира при вход."
