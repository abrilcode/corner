#!/bin/zsh
# Screenshots of the window in a given state, from a copy of tests/fixture.json.
#   tools/shot.sh <state> <out.png> [light|dark] [height]
# states: list, dump, sorting, review, edit, done, mini
set -e
here=${0:A:h}/..
tmp=$(mktemp -d)
cp "$here/tests/fixture.json" "$tmp/corner.json"
# CORNER_SHOT_IDS=0: the default for new lists (no project IDs), as in the README.
if [[ "$CORNER_SHOT_IDS" == "0" ]]; then
  python3 -c 'import json,sys; p=sys.argv[1]; d=json.load(open(p)); d["settings"]["projectIds"]=False; json.dump(d, open(p, "w"))' "$tmp/corner.json"
fi
CORNER_TEST=1 CORNER_DATA="$tmp/corner.json" CORNER_SHOT="$2" CORNER_SHOT_STATE="$1" CORNER_THEME="${3:-light}" CORNER_SHOT_HEIGHT="${4:-480}" \
  "$here/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$here" 2>&1 | grep '\[corner\]' || true
rm -rf "$tmp"
