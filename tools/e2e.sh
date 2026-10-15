#!/bin/zsh
# End-to-end run of the real window on a copy of the fixture (see tests/e2e.js).
here=${0:A:h}/..
tmp=$(mktemp -d)
cp "$here/tests/fixture.json" "$tmp/corner.json"
CORNER_TEST=1 CORNER_DATA="$tmp/corner.json" CORNER_E2E="$here/tests/e2e.js" \
  "$here/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" "$here" 2>&1 | grep -E '^(PASS|FAIL|[0-9]+/[0-9]+|Error|\s+at )'
code=${pipestatus[1]}
rm -rf "$tmp"
exit $code
