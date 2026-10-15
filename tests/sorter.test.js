const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const store = require("../lib/store");
const sorter = require("../lib/sorter");
const { sortLocally, pieces } = require("../lib/localsort");

const data = store.normalize(JSON.parse(fs.readFileSync(path.join(__dirname, "fixture.json"), "utf8")));

test("the message lists projects, IDs, keywords and open items", () => {
  const m = sorter.message(data, "  call Maya  ", new Date("2026-10-15T12:00:00Z"));
  assert.match(m, /Today: 2026-10-15/);
  assert.match(m, /id: website · name: Website relaunch · project ID pj_4f9a2c71e0b3d5a8 · keywords: website/);
  assert.match(m, /\[website\] Ask Maya for the new hero photo/);
  assert.doesNotMatch(m, /Schedule the second interviews/); // done items are not sent
  assert.match(m, /"""\ncall Maya\n"""/);
});

test("the schema only allows known projects or new, and P0 / P1 / none", () => {
  const s = sorter.schema(data.projects.map((p) => p.id)).properties.items.items;
  assert.deepEqual(s.properties.project.enum, [...data.projects.map((p) => p.id), "new"]);
  assert.deepEqual(s.properties.priority.enum, ["P0", "P1", "none"]);
});

test("proposals map onto real projects and priorities", () => {
  const out = sorter.proposals(data, {
    items: [
      { project: "website", text: " Email Maya ", links: ["https://a.b"], priority: "P0" },
      { project: "made-up", text: "Falls to general", links: [], priority: "none" },
      { project: "new", newProject: "Hiring", text: "Existing by name", links: [], priority: "P1" },
      { project: "new", newProject: "Offsite", text: "New one", links: [], priority: "P3" },
      { project: "general", text: "  ", links: [], priority: "none" },
    ],
  });
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], { project: "website", newProject: "", text: "Email Maya", links: ["https://a.b"], priority: "P0" });
  assert.equal(out[1].project, "general");
  assert.equal(out[1].priority, "");
  assert.equal(out[2].project, "hiring");
  assert.equal(out[2].newProject, "");
  assert.equal(out[3].newProject, "Offsite");
  assert.equal(out[3].priority, "");
});

test("without Claude: split into lines and sentences, filed by keywords", () => {
  const dump = "ok so I need to ask Maya for the hero photo, urgent. Check the Q4 totals https://example.com/q4\n- book a haircut; also renew the passport\nAsk Maya for the new hero photo";
  assert.equal(pieces(dump).length, 5);
  const out = sortLocally(data, dump);
  assert.deepEqual(out.map((o) => [o.project, o.text, o.priority]), [
    ["website", "Ask Maya for the hero photo", "P0"],
    ["q4-report", "Check the Q4 totals", ""],
    ["general", "Book a haircut", ""],
    ["general", "Renew the passport", ""],
  ]);
  assert.deepEqual(out[1].links, ["https://example.com/q4"]);
});
