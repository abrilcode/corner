// Corner's window: the brain dump, Claude's proposal, and the list by project.
// Every change goes through window.corner.op(), which re-reads the shared
// file, applies the change and returns the new list.

"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DONE_DAYS = 14;

const prefs = Object.assign({ collapsed: {}, quietOpen: false, doneOpen: false }, JSON.parse(localStorage.getItem("corner.prefs") || "{}"));
const savePrefs = () => localStorage.setItem("corner.prefs", JSON.stringify(prefs));

let data = null;
let loadError = null;
let dataFile = "";
let proposal = null; // Claude's items, waiting to be kept or left out
let editing = null; // { kind: "item" | "add" | "link" | "project" | "new-project", id }
let pending = false; // a render waiting for the current edit to finish
let sorting = false;
let claude = true; // Claude Code found on this Mac; without it the sort uses keywords
const leaving = new Map(); // items just ticked, still shown for a moment

// ---- small helpers -----------------------------------------------------

const ICON = {
  chev: '<svg viewBox="0 0 10 10"><path d="M3.5 2l3 3-3 3"/></svg>',
  link: '<svg viewBox="0 0 10 10"><path d="M4.2 5.8l1.6-1.6M3.6 4.1L2.5 5.2a1.6 1.6 0 0 0 2.3 2.3l1.1-1.1M6.4 5.9l1.1-1.1a1.6 1.6 0 0 0-2.3-2.3L4.1 3.6"/></svg>',
  file: '<svg viewBox="0 0 10 10"><path d="M2.5 1.2h3.3l1.9 1.9v5.7H2.5z M5.7 1.2v2h2"/></svg>',
};

function linkLabel(url) {
  const u = url.toLowerCase();
  const rules = [
    [/docs\.google\.com\/document/, "doc"], [/docs\.google\.com\/spreadsheets/, "sheet"],
    [/docs\.google\.com\/presentation/, "slides"], [/docs\.google\.com\/forms/, "form"],
    [/drive\.google\.com/, "drive"], [/github\.com/, "github"], [/slack\.com/, "slack"],
    [/notion\.(so|site)/, "notion"], [/redash/, "redash"], [/figma\.com/, "figma"],
    [/linear\.app/, "linear"], [/atlassian\.net|jira/, "jira"],
  ];
  for (const [re, label] of rules) if (re.test(u)) return label;
  if (/^https?:\/\//.test(u)) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host.endsWith(".vercel.app")) return host.replace(".vercel.app", "");
      return host.split(".").slice(-2, -1)[0] || host;
    } catch { return "link"; }
  }
  const base = url.replace(/\/+$/, "").split("/").pop() || url;
  return base;
}
const isFile = (url) => !/^[a-z]+:/i.test(url) || /^file:/i.test(url);

function linksHTML(links) {
  if (!links.length) return "";
  return `<div class="links">${links.map((l) => `<button class="link" data-open="${esc(l.url)}" title="${esc(l.url)}">${isFile(l.url) ? ICON.file : ICON.link}<span>${esc(l.label || linkLabel(l.url))}</span></button>`).join("")}</div>`;
}

const rank = (i) => ({ P0: 0, P1: 1 })[i.priority] ?? 2;
const prioHTML = (p, id) => (p ? `<button class="prio ${p.toLowerCase()}" ${id ? `data-prio="${esc(id)}" title="Priority ${p} (click to change)"` : 'tabindex="-1"'}>${p}</button>` : "");
const shortId = (id) => (id.length > 10 ? `${id.slice(0, 8)}…` : id);
const project = (id) => data.projects.find((p) => p.id === id);
const recentDone = () => {
  const since = Date.now() - DONE_DAYS * 864e5;
  return data.items.filter((i) => i.done && !leaving.has(i.id) && Date.parse(i.doneAt || 0) >= since)
    .sort((a, b) => Date.parse(b.doneAt) - Date.parse(a.doneAt));
};

function accept(res) {
  if (!res) return;
  if (res.data) data = res.data;
  loadError = res.error || null;
}

async function op(o) {
  const res = await window.corner.op(o);
  accept(res);
  if (res.error) toast(res.error);
  render();
  return res;
}

function request() {
  if (editing) pending = true;
  else render();
}

function stopEditing() {
  editing = null;
  pending = false;
  render();
}

// ---- toast (with undo) -------------------------------------------------

let toastTimer = null;
function toast(text, undo) {
  const t = $("toast");
  t.innerHTML = `<span>${esc(text)}</span>${undo ? "<button>Undo</button>" : ""}`;
  t.hidden = false;
  if (undo) t.querySelector("button").onclick = () => { t.hidden = true; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 6500 : 4000);
}

// ---- render ------------------------------------------------------------

function render() {
  if (!data) {
    $("list").innerHTML = loadError ? `<div class="error">${esc(loadError)}</div>` : "";
    return;
  }
  const visible = (i) => !i.done || leaving.has(i.id);
  const byProject = new Map(data.projects.map((p) => [p.id, []]));
  for (const i of data.items) if (visible(i) && byProject.has(i.project)) byProject.get(i.project).push(i);
  for (const list of byProject.values()) list.sort((a, b) => rank(a) - rank(b)); // P0, then P1, then the rest

  const open = data.items.filter((i) => !i.done);
  const p0 = open.filter((i) => i.priority === "P0").length;
  $("count").textContent = open.length ? `${open.length} open${p0 ? ` · ${p0} P0` : ""}` : "all clear";

  const busy = (p) => editing && (editing.id === p.id) && (editing.kind === "add" || editing.kind === "project");
  const active = data.projects.filter((p) => byProject.get(p.id).length || busy(p));
  const quiet = data.projects.filter((p) => !active.includes(p));

  let html = loadError ? `<div class="error list-error">${esc(loadError)}</div>` : "";
  if (!active.length && !proposal) {
    html += `<div class="empty"><em>Nothing open.</em>Write a brain dump above, or use + on a project.</div>`;
  }
  html += active.map((p) => projectHTML(p, byProject.get(p.id))).join("");

  if (quiet.length) {
    html += `<button class="section-toggle ${prefs.quietOpen ? "open" : ""}" data-section="quiet"><span class="chev">${ICON.chev}</span>Quiet · ${quiet.length} project${quiet.length === 1 ? "" : "s"}</button>`;
    if (prefs.quietOpen) html += `<div class="quiet">${quiet.map((p) => projectHTML(p, [], true)).join("")}</div>`;
  }
  if (editing && editing.kind === "new-project") html += formHTML(null);

  const done = recentDone();
  if (prefs.doneOpen && done.length) {
    html += `<div class="section-toggle open" data-section="done"><span class="chev">${ICON.chev}</span>Done in the last ${DONE_DAYS} days</div>`;
    html += `<ul class="items done-list">${done.map((i) => itemHTML(i, project(i.project)?.name)).join("")}</ul>`;
  }
  $("list").innerHTML = html;
  $("doneBtn").textContent = done.length ? `Done · ${done.length}` : "Done";
  $("doneBtn").disabled = !done.length;

  renderReview();
  focusEditor();
}

function projectHTML(p, items, isQuiet = false) {
  if (editing && editing.kind === "project" && editing.id === p.id) return formHTML(p);
  const open = !isQuiet && !prefs.collapsed[p.id];
  const name = p.dashboard
    ? `<a class="name" data-open="${esc(p.dashboard)}" title="Open the dashboard: ${esc(p.dashboard)}">${esc(p.name)}<span class="arrow">↗</span></a>`
    : `<span class="name">${esc(p.name)}</span>`;
  const pid = p.projectId ? `<button class="pid" data-copy="${esc(p.projectId)}" title="Copy project ID ${esc(p.projectId)}">${esc(shortId(p.projectId))}</button>` : "";
  const n = items.filter((i) => !i.done).length;
  const adding = editing && editing.kind === "add" && editing.id === p.id;
  return `<section class="proj ${open || adding ? "open" : ""}" data-project="${esc(p.id)}">
    <div class="head" data-head="${esc(p.id)}">
      <span class="chev">${isQuiet ? "" : ICON.chev}</span>${name}${pid}<span class="fill"></span>
      <button class="plus" data-add="${esc(p.id)}" title="Add an item to ${esc(p.name)}">+</button>
      <span class="n">${n || ""}</span>
    </div>
    ${open || adding ? `<ul class="items">${(open ? items : []).map((i) => itemHTML(i)).join("")}${adding ? `<li class="adder"><input class="edit" data-editor="add" placeholder="New item · Enter adds, Esc closes"></li>` : ""}</ul>` : ""}
  </section>`;
}

function itemHTML(i, metaText) {
  const isEditing = editing && editing.id === i.id;
  const text = isEditing && editing.kind === "item"
    ? `<input class="edit" data-editor="item" value="${esc(i.text)}">`
    : `<div class="text">${prioHTML(i.priority, i.done ? "" : i.id)}${esc(i.text)}</div>`;
  const linker = isEditing && editing.kind === "link" ? `<input class="edit linker" data-editor="link" placeholder="Paste a link or a file path · Enter">` : "";
  const cls = [i.done ? "done" : "", leaving.has(i.id) ? "leaving" : ""].join(" ");
  return `<li class="item ${cls}" data-item="${esc(i.id)}">
    <button class="check" data-toggle="${esc(i.id)}" aria-label="${i.done ? "Mark as open" : "Mark as done"}" title="${i.done ? "Mark as open" : "Done"}"></button>
    <div class="body">${text}${linksHTML(i.links)}${linker}${metaText ? `<div class="meta">${esc(metaText)}</div>` : ""}</div>
  </li>`;
}

function formHTML(p) {
  const v = p || { name: "", projectId: "", dashboard: "", keywords: "" };
  return `<form class="form" data-form="${p ? esc(p.id) : ""}">
    <label>Name<input name="name" value="${esc(v.name)}" required></label>
    <label>Project ID<input name="projectId" class="mono" value="${esc(v.projectId)}" placeholder="optional"></label>
    <label>Dashboard<input name="dashboard" value="${esc(v.dashboard)}" placeholder="https://… (opens from the name)"></label>
    <label>Keywords for Claude<input name="keywords" value="${esc(v.keywords)}" placeholder="other names, people, tools"></label>
    <div class="row"><button type="button" class="btn" data-cancel>Cancel</button><button type="submit" class="btn primary">${p ? "Save" : "Add project"}</button></div>
  </form>`;
}

function focusEditor() {
  const el = document.querySelector("[data-editor]") || document.querySelector(".form input[name=name]");
  if (!el || document.activeElement === el) return;
  el.focus();
  if (el.dataset.editor === "item") el.setSelectionRange(el.value.length, el.value.length);
}

// ---- Claude's proposal -------------------------------------------------

function renderReview() {
  const box = $("review");
  $("dump").hidden = !!proposal;
  if (!proposal) { box.hidden = true; box.innerHTML = ""; return; }
  const groups = new Map();
  proposal.forEach((it, index) => {
    const key = it.newProject ? `new:${it.newProject}` : it.project;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...it, index });
  });
  const who = claude ? "Claude found" : "Found";
  const title = proposal.length ? `${who} ${proposal.length} item${proposal.length === 1 ? "" : "s"}. Right-click one to move it or set a priority.` : "Nothing left to add.";
  let html = `<p class="review-title">${esc(title)}</p>`;
  for (const [key, list] of groups) {
    const label = key.startsWith("new:") ? `${esc(key.slice(4))} <span class="new">· new project</span>` : esc(project(key)?.name || "General");
    html += `<div class="group-name">${label}</div><ul>${list.map((it) => `<li data-proposal="${it.index}"><span class="dot"></span><span class="text">${prioHTML(it.priority)}${esc(it.text)}${it.links.length ? `<br>${linksHTML(it.links.map((url) => ({ url, label: "" })))}` : ""}</span><button class="x" data-drop="${it.index}" title="Leave out">×</button></li>`).join("")}</ul>`;
  }
  if (!claude && proposal.length) html += `<p class="review-note">Sorted by project names and keywords. With Claude Code installed, Claude sorts it.</p>`;
  html += `<div class="row">${proposal.length ? `<button class="btn primary" id="keepBtn">Add ${proposal.length}</button>` : ""}<button class="btn" id="backBtn">Back to the dump</button><button class="btn" id="discardBtn">Discard</button></div>`;
  box.innerHTML = html;
  box.hidden = false;
  const keep = $("keepBtn");
  if (keep) keep.onclick = keepProposal;
  $("backBtn").onclick = () => { proposal = null; render(); $("dumpText").focus(); };
  $("discardBtn").onclick = () => { proposal = null; setDump(""); render(); };
}

async function keepProposal() {
  const items = proposal.map((p) => ({ project: p.project, newProject: p.newProject, text: p.text, links: p.links, priority: p.priority }));
  proposal = null;
  setDump("");
  const res = await op({ type: "add", items, source: claude ? "claude" : "keywords" });
  const added = Array.isArray(res.result) ? res.result : [];
  if (added.length) {
    toast(`Added ${added.length} item${added.length === 1 ? "" : "s"}`, async () => {
      for (const it of added) await window.corner.op({ type: "delete", id: it.id });
      accept(await window.corner.load());
      render();
    });
  }
}

// ---- the brain dump ----------------------------------------------------

function setDump(text) {
  const t = $("dumpText");
  t.value = text;
  sizeDump();
}

function sizeDump() {
  const t = $("dumpText");
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight + 2, 168)}px`;
  t.style.overflowY = t.scrollHeight > 166 ? "auto" : "hidden";
  $("dumpActions").hidden = sorting || !t.value.trim();
}

function showDumpError(msg) {
  const e = $("dumpError");
  e.textContent = msg || "";
  e.hidden = !msg;
}

async function sortDump() {
  const text = $("dumpText").value.trim();
  if (!text || sorting) return;
  sorting = true;
  showDumpError("");
  $("dumpText").readOnly = true;
  $("sorting").hidden = false;
  sizeDump();
  const res = await window.corner.sort(text);
  sorting = false;
  $("dumpText").readOnly = false;
  $("sorting").hidden = true;
  sizeDump();
  if (res.error) {
    if (res.error !== "cancelled") showDumpError(res.error);
    return;
  }
  if (!res.items.length) { showDumpError(claude ? "Claude found nothing to do in that." : "Nothing to add in that."); return; }
  proposal = res.items;
  render();
}

async function addAsIs() {
  const lines = $("dumpText").value.split(/\n+/).map((l) => l.replace(/^\s*([-*•·]|\d+[.)]|\[ ?\])\s*/, "").trim()).filter(Boolean);
  if (!lines.length) return;
  setDump("");
  const res = await op({ type: "add", items: lines.map((text) => ({ project: "general", text })) });
  const added = Array.isArray(res.result) ? res.result : [];
  toast(`Added ${added.length} to General`, async () => {
    for (const it of added) await window.corner.op({ type: "delete", id: it.id });
    accept(await window.corner.load());
    render();
  });
}

// ---- drag and drop -----------------------------------------------------

function dropped(e) {
  const dt = e.dataTransfer;
  const out = [];
  for (const f of dt.files || []) {
    const p = window.corner.pathForFile(f);
    if (p) out.push({ url: p, name: f.name.replace(/\.[^.]+$/, "") });
  }
  if (out.length) return out;
  let title = "";
  const html = dt.getData("text/html");
  if (html) title = new DOMParser().parseFromString(html, "text/html").body.textContent.trim().slice(0, 100);
  const raw = dt.getData("text/uri-list") || dt.getData("text/plain");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t && !t.startsWith("#") && /^(https?:\/\/|file:\/\/|\/|~\/)/.test(t)) out.push({ url: t, name: title && !/^https?:/.test(title) ? title : "" });
  }
  return out;
}

function shortUrl(url) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "").slice(0, 70);
  } catch { return url.split("/").pop() || url; }
}

function wireDrops() {
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());
  const clear = () => document.querySelectorAll(".drop").forEach((el) => el.classList.remove("drop"));
  const target = (e) => e.target.closest?.(".item, .head, #dumpText");
  document.addEventListener("dragenter", (e) => { clear(); const t = target(e); if (t) t.classList.add("drop"); });
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) clear(); });
  document.addEventListener("drop", async (e) => {
    const t = target(e);
    clear();
    if (!t) return;
    const got = dropped(e);
    if (!got.length) return;
    if (t.id === "dumpText") {
      const v = $("dumpText").value;
      setDump(`${v}${v && !v.endsWith("\n") ? " " : ""}${got.map((g) => g.url).join(" ")}`);
      $("dumpText").focus();
    } else if (t.classList.contains("item")) {
      for (const g of got) await op({ type: "link", id: t.dataset.item, url: g.url, label: "" });
      toast(`Linked ${got.length === 1 ? linkLabel(got[0].url) : `${got.length} links`}`);
    } else if (t.dataset.head) {
      await op({ type: "add", items: got.map((g) => ({ project: t.dataset.head, text: g.name || `Open ${shortUrl(g.url)}`, links: [g.url] })) });
    }
  });
}

// ---- events ------------------------------------------------------------

function startEdit(kind, id) {
  editing = { kind, id };
  if (kind === "add" && prefs.collapsed[id]) { delete prefs.collapsed[id]; savePrefs(); }
  render();
}

// how: "enter" saves (and keeps the add field open for the next item),
// "blur" saves and closes, "escape" closes without saving.
async function finishEditor(el, how) {
  if (!editing) return;
  const kind = el.dataset.editor;
  const value = el.value.trim();
  const id = editing.id;
  editing = null;
  const save = how !== "escape" && value;
  if (kind === "add" && save) await window.corner.op({ type: "add", items: [{ project: id, text: value }] }).then(accept);
  if (kind === "item" && save) await window.corner.op({ type: "edit", id, text: value }).then(accept);
  if (kind === "link" && save) await window.corner.op({ type: "link", id, url: value, label: "" }).then(accept);
  if (kind === "add" && how === "enter" && value) editing = { kind: "add", id };
  pending = false;
  render();
}

function wire() {
  const list = $("list");

  list.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-prio],[data-toggle],[data-open],[data-copy],[data-add],[data-section],[data-head],[data-cancel]");
    if (!el) return;
    if (el.dataset.prio) {
      const it = data.items.find((i) => i.id === el.dataset.prio);
      if (it) await op({ type: "priority", id: it.id, priority: { P0: "P1", P1: "" }[it.priority] ?? "P0" });
    } else if (el.dataset.toggle) {
      const id = el.dataset.toggle;
      const it = data.items.find((i) => i.id === id);
      if (!it) return;
      if (!it.done) {
        leaving.set(id, setTimeout(() => { leaving.delete(id); request(); }, 1600));
      } else if (leaving.has(id)) {
        clearTimeout(leaving.get(id));
        leaving.delete(id);
      }
      await op({ type: "toggle", id });
    } else if (el.dataset.open) {
      e.preventDefault();
      const res = await window.corner.open(el.dataset.open);
      if (res && !res.ok && res.error) toast(res.error);
    } else if (el.dataset.copy) {
      await window.corner.copy(el.dataset.copy);
      const was = el.textContent;
      el.textContent = "copied";
      setTimeout(() => { el.textContent = was; }, 1100);
    } else if (el.dataset.add) {
      startEdit("add", el.dataset.add);
    } else if (el.dataset.section) {
      const key = el.dataset.section === "quiet" ? "quietOpen" : "doneOpen";
      prefs[key] = !prefs[key];
      savePrefs();
      render();
    } else if (el.dataset.cancel !== undefined) {
      stopEditing();
    } else if (el.dataset.head) {
      const id = el.dataset.head;
      if (el.closest(".quiet")) return startEdit("add", id);
      prefs.collapsed[id] = !prefs.collapsed[id];
      savePrefs();
      render();
    }
  });

  list.addEventListener("dblclick", (e) => {
    const li = e.target.closest(".item .text");
    if (li) startEdit("item", li.closest(".item").dataset.item);
  });

  list.addEventListener("contextmenu", (e) => {
    const item = e.target.closest(".item");
    const head = e.target.closest(".head");
    if (item) { e.preventDefault(); window.corner.itemMenu(item.dataset.item); }
    else if (head) { e.preventDefault(); window.corner.projectMenu(head.dataset.head); }
  });

  list.addEventListener("keydown", (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.editor) return;
    if (e.key === "Enter") { e.preventDefault(); finishEditor(el, "enter"); }
    if (e.key === "Escape") { e.preventDefault(); finishEditor(el, "escape"); }
  });
  list.addEventListener("focusout", (e) => {
    const el = e.target;
    if (el.dataset && el.dataset.editor && editing) setTimeout(() => { if (document.activeElement !== el && el.isConnected) finishEditor(el, "blur"); }, 0);
  });

  list.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = Object.fromEntries(new FormData(f).entries());
    if (!v.name.trim()) return;
    editing = null;
    if (f.dataset.form) await op({ type: "project-edit", id: f.dataset.form, ...v });
    else await op({ type: "project-add", ...v });
    stopEditing();
  });
  list.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && e.target.closest(".form")) stopEditing();
  });

  // review box
  $("review").addEventListener("click", (e) => {
    const x = e.target.closest("[data-drop]");
    if (x) { proposal.splice(Number(x.dataset.drop), 1); render(); return; }
    const l = e.target.closest("[data-open]");
    if (l) window.corner.open(l.dataset.open);
  });
  $("review").addEventListener("contextmenu", (e) => {
    const li = e.target.closest("[data-proposal]");
    if (!li) return;
    e.preventDefault();
    const i = Number(li.dataset.proposal);
    window.corner.proposalMenu(i, proposal[i].newProject ? "" : proposal[i].project, proposal[i].priority || "");
  });

  // dump
  const t = $("dumpText");
  t.addEventListener("input", () => { sizeDump(); showDumpError(""); });
  t.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.shiftKey ? addAsIs() : sortDump(); }
    if (e.key === "Escape") t.blur();
  });
  $("sortBtn").onclick = sortDump;
  $("asIsBtn").onclick = addAsIs;
  $("cancelSort").onclick = () => window.corner.cancelSort();

  // bar
  $("bar").addEventListener("dblclick", (e) => { if (!e.target.closest("button")) setMini(!document.body.classList.contains("mini"), true); });
  $("miniBtn").onclick = () => setMini(!document.body.classList.contains("mini"), true);
  $("menuBtn").onclick = () => window.corner.appMenu();
  $("cornerBtn").onclick = (e) => { e.stopPropagation(); $("picker").hidden = !$("picker").hidden; };
  $("picker").addEventListener("click", (e) => {
    const b = e.target.closest("[data-c]");
    if (b) { window.corner.move(b.dataset.c); $("picker").hidden = true; }
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#picker")) $("picker").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("picker").hidden = true; });

  // footer
  $("doneBtn").onclick = () => { prefs.doneOpen = !prefs.doneOpen; savePrefs(); render(); if (prefs.doneOpen) $("main").scrollTo({ top: 1e6, behavior: "smooth" }); };
  $("newProjectBtn").onclick = () => { editing = { kind: "new-project", id: "" }; render(); $("main").scrollTo({ top: 1e6 }); };

  // from the app (file changes, context menus, mini mode)
  window.corner.onData((res) => { accept(res); request(); });
  window.corner.onMini((on) => setMini(on, false));
  window.corner.onFocusDump(() => { if (!proposal) $("dumpText").focus(); });
  window.corner.onAction(async (a) => {
    if (a.action === "edit") startEdit("item", a.id);
    else if (a.action === "link") startEdit("link", a.id);
    else if (a.action === "add") startEdit("add", a.id);
    else if (a.action === "edit-project") startEdit("project", a.id);
    else if (a.action === "changed") { accept(a); if (a.error) toast(a.error); render(); }
    else if (a.action === "deleted") {
      accept(a);
      render();
      toast("Deleted", async () => { await op({ type: "restore", item: a.item }); });
    } else if (a.action === "proposal-project" && proposal && proposal[a.index]) {
      proposal[a.index].project = a.project;
      proposal[a.index].newProject = "";
      render();
    } else if (a.action === "proposal-priority" && proposal && proposal[a.index]) {
      proposal[a.index].priority = a.priority;
      render();
    } else if (a.action === "proposal-drop" && proposal) {
      proposal.splice(a.index, 1);
      render();
    }
  });

  wireDrops();
}

function setMini(on, tell) {
  document.body.classList.toggle("mini", on);
  $("miniBtn").innerHTML = on
    ? '<svg viewBox="0 0 14 14"><rect x="3" y="3" width="8" height="8" rx="1.5"/></svg>'
    : '<svg viewBox="0 0 14 14"><path d="M3 7h8"/></svg>';
  $("miniBtn").title = on ? "Open (or double-click the bar)" : "Mini (or double-click the bar)";
  if (tell) window.corner.mini(on);
}

// ---- start -------------------------------------------------------------

async function start() {
  const res = await window.corner.load();
  accept(res);
  dataFile = res.file;
  claude = res.claude !== false;
  if (!claude) {
    $("sortBtn").textContent = "Sort by project";
    $("dumpText").placeholder = "Brain dump. Sorted by project, one item per line or sentence.";
    $("sorting").firstElementChild.textContent = "Sorting";
  }
  setMini(!!res.mini, false);
  wire();
  render();
  const shot = new URLSearchParams(location.search).get("shot");
  if (shot) await runShot(shot);
}

// Screenshot states for tests/shots.sh. Never used in normal runs.
async function runShot(kind) {
  if (kind === "dump") {
    setDump("Need to ask Maya for the new hero photo for the website, also the Q4 report numbers look off https://example.com/q4 and book the dentist");
  }
  if (kind === "sorting") {
    setDump("Ask Maya for the hero photo; Q4 report numbers look off; book the dentist");
    sorting = true;
    $("sorting").hidden = false;
    sizeDump();
  }
  if (kind === "review") {
    proposal = [
      { project: "website", newProject: "", text: "Ask Maya for the new hero photo", links: [], priority: "P0" },
      { project: "q4-report", newProject: "", text: "Recheck the Q4 report numbers", links: ["https://example.com/q4"], priority: "" },
      { project: "general", newProject: "", text: "Book the dentist", links: [], priority: "" },
      { project: "general", newProject: "Offsite", text: "Send the agenda to the team", links: [], priority: "P1" },
    ];
    render();
  }
  if (kind === "localsort") {
    setDump("ok so I need to ask Maya about the pricing page, urgent. Check the Q4 totals https://example.com/q4\n- book a haircut; also renew the passport");
    await sortDump();
  }
  if (kind === "edit") { editing = { kind: "project", id: data.projects[1].id }; render(); }
  if (kind === "done") { prefs.doneOpen = true; render(); }
  if (kind === "watch") await new Promise((r) => window.corner.onData(() => setTimeout(r, 200)));
  await document.fonts.ready;
  window.corner.rendered();
}

start();
