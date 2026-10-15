// Drives the real window end to end (loaded by main.js when CORNER_E2E points
// here). Run: tools/e2e.sh   It uses a copy of tests/fixture.json and makes
// one real "Sort with Claude" call (about one cent).
const fs = require("node:fs");
const { screen } = require("electron");

// `test.copied()` is the app's private test clipboard; the real one is never touched.
module.exports = async function e2e(win, file, test) {
  const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const data = () => JSON.parse(fs.readFileSync(file, "utf8"));
  const results = [];
  const check = (name, ok, extra = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` (${extra})` : ""}`); };
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await wait(80); } return false; };

  await until(() => js(`return document.getElementById("count").textContent === "7 open · 1 P0"`));
  check("renders the fixture, P0 counted", await js(`return document.querySelectorAll(".item").length === 7 && document.getElementById("count").textContent === "7 open · 1 P0"`));
  check("P1 sorts above unmarked", await js(`return [...document.querySelectorAll('[data-project="q4-report"] .item')].map((e) => e.dataset.item).join() === "fx07,fx06"`));

  // tick an item: saved at once, shown faded for a moment, then gone
  await js(`document.querySelector('[data-toggle="fx01"]').click()`);
  await until(() => data().items.find((i) => i.id === "fx01").done);
  check("ticking saves done", data().items.find((i) => i.id === "fx01").done);
  check("ticked item lingers", await js(`return !!document.querySelector('[data-item="fx01"].leaving')`));
  check("then leaves", await until(() => js(`return !document.querySelector('[data-item="fx01"]') && document.getElementById("count").textContent === "6 open · 1 P0"`), 3000));

  // add through + (the field stays open for the next item, Esc closes it)
  await js(`document.querySelector('[data-add="q4-report"]').click()`);
  const typed = await js(`const i = document.querySelector('[data-editor="add"]'); i.value = "P0 Fetch the labels https://example.com/labels"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return document.activeElement === i || true;`);
  await until(() => data().items.some((i) => i.text === "Fetch the labels"));
  const added = data().items.find((i) => i.text === "Fetch the labels");
  check("+ adds to that project, P0 and link from the text", added && added.project === "q4-report" && added.priority === "P0" && added.links[0].url === "https://example.com/labels");
  check("add field stays open", await until(() => js(`return !!document.querySelector('[data-editor="add"]')`)));
  await js(`document.querySelector('[data-editor="add"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  check("Esc closes it", await until(() => js(`return !document.querySelector('[data-editor="add"]')`)));

  // edit with a double-click
  await js(`document.querySelector('[data-item="fx02"] .text').dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
  await js(`const i = document.querySelector('[data-editor="item"]'); i.value = "Renew the card online"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  check("double-click edits", await until(() => data().items.find((i) => i.id === "fx02").text === "Renew the card online"));

  // a change made elsewhere (the skill) shows up while nothing is being edited
  const d = data();
  d.items.push({ id: "ext1", project: "hiring", text: "From the skill", links: [], done: false, created: new Date().toISOString(), doneAt: null, source: "claude-code" });
  fs.writeFileSync(file, JSON.stringify(d, null, 2));
  check("outside edits appear", await until(() => js(`return !!document.querySelector('[data-item="ext1"]')`)));

  // brain dump, "Add as is", then undo
  await js(`const t = document.getElementById("dumpText"); t.value = "- first loose thought\\n- second one"; t.dispatchEvent(new Event("input"))`);
  check("dump shows its buttons", await js(`return !document.getElementById("dumpActions").hidden`));
  await js(`document.getElementById("asIsBtn").click()`);
  await until(() => data().items.some((i) => i.text === "second one"));
  check("Add as is: one item per line, bullets removed", ["first loose thought", "second one"].every((t) => data().items.some((i) => i.text === t && i.project === "general")));
  await js(`document.querySelector("#toast button").click()`);
  check("Undo removes them", await until(() => !data().items.some((i) => i.text === "second one")));

  // a real sort with Claude, then keep the proposal
  await js(`const t = document.getElementById("dumpText"); t.value = "tell Maya the website footer still shows the old address, it's urgent, and book a haircut"; t.dispatchEvent(new Event("input")); document.getElementById("sortBtn").click()`);
  check("sorting shows progress", await js(`return !document.getElementById("sorting").hidden`));
  const got = await until(() => js(`return !!document.getElementById("keepBtn")`), 90000);
  const shown = await js(`return [...document.querySelectorAll("#review li .text")].map((e) => e.textContent)`);
  check("Claude proposes items", got && shown.length >= 2, shown.join(" | "));
  await js(`document.getElementById("keepBtn").click()`);
  const sorted = () => data().items.filter((i) => i.source === "claude" || i.source === "keywords");
  await until(() => sorted().length >= 2);
  check("kept items are saved", sorted().length >= 2, sorted().map((i) => `${i.project}: ${i.priority} ${i.text}`).join(" | "));
  check("the Maya item went to Website, as P0", sorted().some((i) => i.project === "website" && /maya/i.test(i.text) && i.priority === "P0"));
  check("dump is cleared", await js(`return document.getElementById("dumpText").value === "" && document.getElementById("review").hidden`));

  // a new project with an ID and a dashboard
  await js(`document.getElementById("newProjectBtn").click()`);
  await until(() => js(`return !!document.querySelector('.form input[name=name]')`));
  await js(`const f = document.querySelector(".form"); f.name.value = "Offsite"; f.projectId.value = "abc123def456abc123def456"; f.dashboard.value = "https://example.com/offsite"; f.requestSubmit()`);
  check("new project saved", await until(() => data().projects.some((p) => p.name === "Offsite" && p.projectId === "abc123def456abc123def456")));
  await js(`document.querySelector('[data-section="quiet"]')?.click()`);
  const quietOk = await until(() => js(`return [...document.querySelectorAll(".quiet .name")].some((e) => e.textContent.includes("Offsite"))`));
  check("an empty project waits under Quiet", quietOk);

  // the project ID copies in full
  await wait(500); // let the file watcher's redraw after the last save pass
  await js(`document.querySelector('[data-copy="pj_4f9a2c71e0b3d5a8"]').click()`);
  await wait(200);
  check("project ID copy icon confirms", await js(`return document.querySelector('[data-copy="pj_4f9a2c71e0b3d5a8"]').classList.contains("copied")`));
  check("project ID copies in full", test.copied() === "pj_4f9a2c71e0b3d5a8");

  // links dropped from the browser attach to an item
  await js(`const dt = new DataTransfer(); dt.setData("text/uri-list", "https://docs.google.com/spreadsheets/d/drop"); document.querySelector('[data-item="fx03"]').dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }))`);
  check("dropped link attaches", await until(() => data().items.find((i) => i.id === "fx03").links.some((l) => l.url.endsWith("/drop"))));
  check("and shows as 'sheet'", await until(() => js(`return [...document.querySelectorAll('[data-item="fx03"] .link span')].some((e) => e.textContent === "sheet")`)));

  // the priority tag cycles P0 → P1 → none
  await js(`document.querySelector('[data-prio="fx03"]').click()`);
  check("P0 tag click → P1", await until(() => data().items.find((i) => i.id === "fx03").priority === "P1"));
  await until(() => js(`return !!document.querySelector('[data-prio="fx03"].p1')`));
  await js(`document.querySelector('[data-prio="fx03"]').click()`);
  check("P1 tag click → none", await until(() => data().items.find((i) => i.id === "fx03").priority === ""));

  // full project names, never cut
  check("project names are not cut", await js(`return [...document.querySelectorAll(".head .name")].every((e) => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== "ellipsis")`));

  // project IDs can be switched off (the default for new lists)
  await js(`await window.corner.op({ type: "setting", key: "projectIds", value: false })`);
  check("IDs off: no copy icons", await until(() => js(`return !document.querySelector(".pid")`)));
  win.webContents.send("corner:action", { action: "edit-project", id: "website" });
  check("IDs off: the form has no Project ID field", await until(() => js(`return !!document.querySelector(".form") && !document.querySelector('.form input[name=projectId]')`)));
  await js(`document.querySelector(".form [data-cancel]").click()`);
  await js(`await window.corner.op({ type: "setting", key: "projectIds", value: true })`);
  check("IDs on again", await until(() => js(`return !!document.querySelector('[data-copy="pj_4f9a2c71e0b3d5a8"]')`)));

  // menu actions (the native context menu sends these)
  win.webContents.send("corner:action", { action: "edit-project", id: "website" });
  check("edit project opens the form", await until(() => js(`return document.querySelector('.form input[name=name]')?.value === "Website relaunch"`)));
  await js(`document.querySelector(".form [data-cancel]").click()`);

  // collapse a project, remembered
  await js(`document.querySelector('[data-head="website"]').click()`);
  check("collapse hides items", await js(`return !document.querySelector('[data-item="fx03"]') && JSON.parse(localStorage.getItem("corner.prefs")).collapsed["website"] === true`));
  await js(`document.querySelector('[data-head="website"]').click()`);

  // working on an item: ▶ starts it (one at a time), the bar shows it, done ends it
  await js(`document.querySelector('[data-focus="fx06"]').click()`);
  check("▶ starts working on it", await until(() => data().items.find((i) => i.id === "fx06").focusAt));
  check("its circle spins and the bar shows it", await until(() => js(`return !!document.querySelector('[data-item="fx06"] .check.spin') && document.querySelector("#count .now-text")?.textContent === "Check the totals against the finance sheet"`)));
  check("it moves to the top of its project", await js(`return document.querySelector('[data-project="q4-report"] .item').dataset.item === "fx06"`));
  await js(`document.querySelector('[data-focus="fx04"]').click()`);
  check("starting another one moves the focus", await until(() => { const d = data().items; return d.find((i) => i.id === "fx04").focusAt && !d.find((i) => i.id === "fx06").focusAt; }));
  await js(`document.querySelector('[data-toggle="fx04"]').click()`);
  check("done ends it; the bar shows the counts again", await until(() => js(`return !document.querySelector("#count .spinner") && /open/.test(document.getElementById("count").textContent)`)) && !data().items.find((i) => i.id === "fx04").focusAt);

  // mini mode and corners
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  await js(`document.getElementById("miniBtn").click()`);
  check("mini shrinks to the bar", await until(() => win.getBounds().height === 46));
  await js(`document.getElementById("miniBtn").click()`);
  check("and opens again", await until(() => win.getBounds().height > 300));
  await js(`document.getElementById("cornerBtn").click(); document.querySelector('[data-c="bottom-left"]').click()`);
  await until(() => win.getBounds().x === area.x + 12);
  const b = win.getBounds();
  check("moves to bottom left", b.x === area.x + 12 && b.y + b.height === area.y + area.height - 12, JSON.stringify(b));
  check("stays on top", win.isAlwaysOnTop());

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  return failed;
};
