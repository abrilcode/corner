#!/bin/zsh
# Screenshots of the window in a given state, from a copy of tests/fixture.json.
#   tools/shot.sh <state> <out.png> [light|dark] [height]
# states: list, dump, sorting, review, edit, done, mini
set -e
here=${0:A:h}/..
tmp=$(mktemp -d)
cp "$here/tests/fixture.json" "$tmp/corner.json"
CORNER_TEST=1 CORNER_DATA="$tmp/corner.json" CORNER_SHOT="$2" CORNER_SHOT_STATE="$1" CORNER_THEME="${3:-light}" CORNER_SHOT_HEIGHT="${4:-480}" \
  "$here/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$here" 2>&1 | grep '\[corner\]' || true
rm -rf "$tmp"
