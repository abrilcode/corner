const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const store = require("../lib/store");

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corner-")), "corner.json");
const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
const fixture = () => store.normalize(read("tests/fixture.json"));

test("first load writes the seed: General only, with the default model", () => {
  const f = tmpFile();
  const d = store.load(f, read("lib/seed.json"));
  assert.ok(fs.existsSync(f));
  assert.deepEqual(d.projects.map((p) => p.id), ["general"]);
  assert.equal(d.settings.model, "sonnet");
});

test("normalize repairs a hand-edited file", () => {
  const d = store.normalize({ projects: [{ id: "x", name: "X" }], items: [{ text: " hi ", project: "nope", priority: "p2", links: ["a", "a", { url: "b" }] }, { text: "" }] });
  assert.equal(d.projects[0].id, "general");
  assert.equal(d.items.length, 1);
  assert.equal(d.items[0].project, "general");
  assert.equal(d.items[0].text, "hi");
  assert.equal(d.items[0].priority, "");
  assert.deepEqual(d.items[0].links.map((l) => l.url), ["a", "b"]);
});

test("URLs typed in an item become links", () => {
  const r = store.splitLinks("Check the tile https://example.com/x, then reply");
  assert.equal(r.text, "Check the tile, then reply");
  assert.deepEqual(r.links, ["https://example.com/x"]);
  assert.equal(store.splitLinks("https://only.link").text, "https://only.link");
});

test("P0 / P1 at the start of the text set the priority", () => {
  assert.deepEqual(store.splitPriority("P0 Send the deck"), { text: "Send the deck", priority: "P0" });
  assert.deepEqual(store.splitPriority("[p1]: Book the room"), { text: "Book the room", priority: "P1" });
  assert.deepEqual(store.splitPriority("Plan P0 work"), { text: "Plan P0 work", priority: "" });
  assert.deepEqual(store.splitPriority("P2 not a priority"), { text: "P2 not a priority", priority: "" });
});

test("add, priority, toggle, edit, link, move, delete, restore", () => {
  const d = fixture();
  const [a] = store.apply(d, { type: "add", items: [{ project: "Website relaunch", text: "P1 Email Maya" }] });
  assert.equal(a.project, "website");
  assert.equal(a.priority, "P1");
  assert.equal(a.text, "Email Maya");
  store.apply(d, { type: "priority", id: a.id, priority: "P0" });
  assert.equal(a.priority, "P0");
  store.apply(d, { type: "priority", id: a.id, priority: "P7" });
  assert.equal(a.priority, "");
  store.apply(d, { type: "toggle", id: a.id });
  assert.equal(a.done, true);
  assert.ok(a.doneAt);
  store.apply(d, { type: "toggle", id: a.id });
  assert.equal(a.done, false);
  assert.equal(a.doneAt, null);
  store.apply(d, { type: "edit", id: a.id, text: "P0 Email Maya today https://x.y/z", project: "general" });
  assert.equal(a.text, "Email Maya today");
  assert.equal(a.priority, "P0");
  assert.equal(a.project, "general");
  assert.equal(a.links[0].url, "https://x.y/z");
  store.apply(d, { type: "link", id: a.id, url: "~/Desktop/notes.md" });
  assert.equal(a.links.length, 2);
  store.apply(d, { type: "unlink", id: a.id, url: "https://x.y/z" });
  assert.equal(a.links.length, 1);
  const copy = { ...a };
  const before = d.items.length;
  assert.equal(store.apply(d, { type: "delete", id: a.id }), true);
  assert.equal(d.items.length, before - 1);
  store.apply(d, { type: "restore", item: copy });
  assert.equal(d.items.at(-1).id, a.id);
  assert.equal(d.items.at(-1).priority, "P0");
});

test("one item in focus at a time; done or stop ends it", () => {
  const d = fixture();
  const get = (id) => d.items.find((i) => i.id === id);
  store.apply(d, { type: "focus", id: "fx03" });
  assert.ok(get("fx03").focusAt);
  store.apply(d, { type: "focus", id: "fx06" });
  assert.equal(get("fx03").focusAt, null);
  assert.ok(get("fx06").focusAt);
  store.apply(d, { type: "focus", id: "fx06" }); // clicking again stops it
  assert.equal(get("fx06").focusAt, null);
  store.apply(d, { type: "focus", id: "fx04", on: true });
  store.apply(d, { type: "toggle", id: "fx04" });
  assert.equal(get("fx04").focusAt, null);
  store.apply(d, { type: "focus", id: "fx08", on: true }); // a done item cannot be in focus
  assert.ok(d.items.every((i) => !i.focusAt));
  assert.equal(store.normalize({ items: [{ text: "x", done: true, focusAt: "2026-01-01T00:00:00Z" }] }).items[0].focusAt, null);
});

test("new projects from Claude are created once, by name", () => {
  const d = fixture();
  store.apply(d, { type: "add", items: [{ project: "new", newProject: "Offsite", text: "Send agenda" }, { project: "new", newProject: "offsite", text: "Book room" }] });
  const off = d.projects.filter((p) => p.name.toLowerCase() === "offsite");
  assert.equal(off.length, 1);
  assert.equal(d.items.filter((i) => i.project === off[0].id).length, 2);
});

test("unknown projects fall back to General", () => {
  const d = fixture();
  const [a] = store.apply(d, { type: "add", items: [{ project: "does-not-exist", text: "Something" }] });
  assert.equal(a.project, "general");
});

test("deleting a project moves its items to General; General stays", () => {
  const d = fixture();
  store.apply(d, { type: "project-delete", id: "q4-report" });
  assert.ok(!d.projects.some((p) => p.id === "q4-report"));
  assert.equal(d.items.find((i) => i.id === "fx06").project, "general");
  assert.throws(() => store.apply(d, { type: "project-delete", id: "general" }));
});

test("projects move but never above General", () => {
  const d = fixture();
  assert.equal(store.apply(d, { type: "project-move", id: "website", by: -1 }), false);
  store.apply(d, { type: "project-move", id: "website", by: 1 });
  assert.equal(d.projects[2].id, "website");
});

test("writes are atomic and keep a backup; a broken file is never overwritten", () => {
  const f = tmpFile();
  store.load(f, read("lib/seed.json"));
  const d = store.read(f);
  store.apply(d, { type: "add", items: [{ text: "One" }] });
  store.write(f, d);
  assert.ok(fs.existsSync(f + ".bak"));
  assert.equal(store.read(f).items.length, 1);
  fs.writeFileSync(f, "{ not json");
  assert.throws(() => store.load(f, read("lib/seed.json")), store.ReadError);
  assert.equal(fs.readFileSync(f, "utf8"), "{ not json");
});
