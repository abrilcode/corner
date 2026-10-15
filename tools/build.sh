#!/bin/zsh
# Builds Corner.app from this checkout and installs it in /Applications (the
# app installs its Claude Code skill itself). For a Mac without Node: the
# tools/bin shims run Electron's own. ~/Desktop/Projects/corner/tools/build.sh
set -e
root=${0:A:h}/..
cd "$root"
export PATH="$root/tools/bin:$PATH"
node --test tests/*.test.js
node tools/build.js
app="dist/mac-arm64/Corner.app"
osascript -e 'tell application "Corner" to quit' 2>/dev/null || true
pkill -x Corner 2>/dev/null || true
sleep 1
rm -rf /Applications/Corner.app
cp -R "$app" /Applications/Corner.app
open /Applications/Corner.app
echo "Installed and opened /Applications/Corner.app"
