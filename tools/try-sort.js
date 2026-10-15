// Runs one real sort against Claude Code with the fixture list:
//   tools/bin/node tools/try-sort.js "dump text"
const fs = require("node:fs");
const path = require("node:path");
const store = require("../lib/store");
const sorter = require("../lib/sorter");

const data = store.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tests", "fixture.json"), "utf8")));
const dump = process.argv[2] || "ok so tomorrow I need to ping Maya about the footer, it's urgent, and the Q4 report needs the totals rechecked (sheet: https://docs.google.com/spreadsheets/d/example/edit). Oh and buy coffee filters. Also for the offsite I have to send the agenda by Friday";
const t0 = Date.now();
sorter.sort(data, dump, { cwd: path.join(require("node:os").tmpdir(), "corner-try") }).promise
  .then((r) => { console.log(JSON.stringify(r, null, 2)); console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)} s`); })
  .catch((e) => { console.error("ERROR", e.message); process.exit(1); });
