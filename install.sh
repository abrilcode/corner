#!/bin/bash
# Installs (or updates) Corner on a Mac:
#   curl -fsSL https://raw.githubusercontent.com/abrilcode/corner/main/install.sh | bash
# Downloads the latest release for this Mac's chip, puts Corner.app in
# /Applications (or ~/Applications), and opens it. The list in ~/.corner is
# never touched, so updating keeps every item.
set -euo pipefail

REPO="abrilcode/corner"
[[ "$(uname -s)" == "Darwin" ]] || { echo "Corner runs on macOS only."; exit 1; }
arch=$(uname -m)
[[ "$arch" == "arm64" ]] || arch="x64"
url="${CORNER_ZIP_URL:-https://github.com/$REPO/releases/latest/download/Corner-mac-$arch.zip}"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Downloading Corner for $( [[ $arch == arm64 ]] && echo 'Apple silicon' || echo 'Intel' )..."
curl -fL --progress-bar "$url" -o "$tmp/Corner.zip"
ditto -x -k "$tmp/Corner.zip" "$tmp/app"
[[ -d "$tmp/app/Corner.app" ]] || { echo "The download did not contain Corner.app."; exit 1; }

dest="/Applications"
if [[ ! -w "$dest" ]]; then dest="$HOME/Applications"; mkdir -p "$dest"; fi
if pgrep -x Corner >/dev/null; then
  osascript -e 'quit app "Corner"' >/dev/null 2>&1 || true
  sleep 1
  pkill -x Corner 2>/dev/null || true
  sleep 1
fi
rm -rf "$dest/Corner.app"
mv "$tmp/app/Corner.app" "$dest/Corner.app"
xattr -dr com.apple.quarantine "$dest/Corner.app" 2>/dev/null || true
open "$dest/Corner.app"

echo
echo "Corner is installed in $dest and opens at every login."
echo "Show or hide it with Control-Option-Space, or the icon in the menu bar."
if command -v claude >/dev/null 2>&1 || [[ -x "$HOME/.local/bin/claude" ]]; then
  echo "Claude Code found: brain dumps are sorted by Claude, and Claude Code chats can add to the list (the corner skill)."
else
  echo "Claude Code not found: brain dumps are sorted by project names and keywords."
  echo "Installing Claude Code later turns on Claude sorting by itself."
fi
