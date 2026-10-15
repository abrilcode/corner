// The list lives in one JSON file (~/.corner/corner.json by default) so that
// both the app and Claude Code (through the corner skill) can read and write
// it. Every change re-reads the file first and writes it atomically, so an
// edit made in a Claude chat is never overwritten by the window.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const VERSION = 1;

function emptyData() {
  return { version: VERSION, projects: [generalProject()], items: [], settings: {} };
}

function generalProject() {
  return { id: "general", name: "General", projectId: "", dashboard: "", keywords: "anything not tied to a project" };
}

const str = (v) => (typeof v === "string" ? v.trim() : "");

// Two priorities only: P0 (now) and P1 (next). Most items have none.
const PRIORITIES = ["P0", "P1"];
const priority = (v) => {
  const p = str(v).toUpperCase();
  return PRIORITIES.includes(p) ? p : "";
};

/** "P0 Send the deck" or "[P1] Send the deck" sets the priority from the text. */
function splitPriority(text) {
  const m = /^\s*\[?(p[01])\]?(?:\s*[:\-–]\s*|\s+)(.+)$/i.exec(text);
  return m ? { text: m[2].trim(), priority: m[1].toUpperCase() } : { text, priority: "" };
}

function normalizeLinks(links) {
  if (!Array.isArray(links)) return [];
  const seen = new Set();
  const out = [];
  for (const l of links) {
    const url = str(typeof l === "string" ? l : l && l.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, label: str(l && l.label) });
  }
  return out;
}

/** Fills in missing fields so the rest of the code can trust the shape. */
function normalize(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const projects = (Array.isArray(d.projects) ? d.projects : [])
    .filter((p) => p && str(p.id) && str(p.name))
    .map((p) => ({
      id: str(p.id), name: str(p.name), projectId: str(p.projectId),
      dashboard: str(p.dashboard), keywords: str(p.keywords),
    }));
  if (!projects.some((p) => p.id === "general")) projects.unshift(generalProject());
  const ids = new Set(projects.map((p) => p.id));
  const items = (Array.isArray(d.items) ? d.items : [])
    .filter((i) => i && str(i.text))
    .map((i) => ({
      id: str(i.id) || newId(),
      project: ids.has(str(i.project)) ? str(i.project) : "general",
      text: str(i.text),
      priority: priority(i.priority),
      links: normalizeLinks(i.links),
      done: !!i.done,
      focusAt: !i.done && str(i.focusAt) ? str(i.focusAt) : null, // being worked on since
      created: str(i.created) || new Date().toISOString(),
      doneAt: i.done ? str(i.doneAt) || new Date().toISOString() : null,
      source: str(i.source) || "app",
    }));
  const settings = d.settings && typeof d.settings === "object" ? d.settings : {};
  return { version: VERSION, projects, items, settings };
}

function newId() {
  return crypto.randomBytes(4).toString("hex");
}

function slug(name, taken) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").replace(/-+/g, "-").slice(0, 40) || "project";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

class ReadError extends Error {}

function read(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  try {
    return normalize(JSON.parse(text));
  } catch (e) {
    throw new ReadError(`${path.basename(file)} is not valid JSON (${e.message}). The last good copy is ${path.basename(file)}.bak.`);
  }
}

function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, file + ".bak"); } catch { /* the backup is best effort */ }
  }
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

/** Reads the file, creating it from the seed the first time. */
function load(file, seed) {
  const d = read(file);
  if (d) return d;
  const fresh = normalize(seed || emptyData());
  write(file, fresh);
  return fresh;
}

// ---- operations --------------------------------------------------------
// Each one takes the freshly read data and an op object, changes the data in
// place and returns a short result. They never touch the disk.

function findProject(d, ref) {
  const r = str(ref).toLowerCase();
  if (!r) return null;
  return d.projects.find((p) => p.id === r) || d.projects.find((p) => p.name.toLowerCase() === r) || null;
}

function addProject(d, { name, projectId, dashboard, keywords }) {
  const n = str(name);
  if (!n) throw new Error("A project needs a name.");
  const existing = findProject(d, n);
  if (existing) return existing;
  const p = {
    id: slug(n, new Set(d.projects.map((x) => x.id))), name: n,
    projectId: str(projectId), dashboard: str(dashboard), keywords: str(keywords),
  };
  d.projects.push(p);
  return p;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;

/** Pulls URLs out of typed text so they become links instead of clutter. */
function splitLinks(text) {
  const links = (text.match(URL_RE) || []).map((u) => u.replace(/[.,;:]+$/, ""));
  const rest = text.replace(URL_RE, (m) => (m.match(/[.,;:]+$/) || [""])[0]).replace(/\s{2,}/g, " ").replace(/\s+([.,;:])/g, "$1").replace(/[\s(:–-]+$/, "").trim();
  return { text: rest || text.trim(), links };
}

function addItems(d, list, source = "app") {
  const added = [];
  for (const raw of list || []) {
    let project = findProject(d, raw.project);
    if (!project && str(raw.newProject)) project = addProject(d, { name: raw.newProject });
    if (!project && str(raw.project) && raw.createProject) project = addProject(d, { name: raw.project });
    project = project || findProject(d, "general");
    const pr = splitPriority(str(raw.text));
    const parts = splitLinks(pr.text);
    if (!parts.text) continue;
    const item = {
      id: newId(), project: project.id, text: parts.text, priority: priority(raw.priority) || pr.priority,
      links: normalizeLinks([...(raw.links || []), ...parts.links]),
      done: false, focusAt: null, created: new Date().toISOString(), doneAt: null, source,
    };
    d.items.push(item);
    added.push(item);
  }
  return added;
}

function item(d, id) {
  const it = d.items.find((i) => i.id === id);
  if (!it) throw new Error("That item no longer exists (it may have been changed elsewhere).");
  return it;
}

function apply(d, op) {
  switch (op && op.type) {
    case "add":
      return addItems(d, op.items, op.source || "app");
    case "toggle": {
      const it = item(d, op.id);
      it.done = op.done === undefined ? !it.done : !!op.done;
      it.doneAt = it.done ? new Date().toISOString() : null;
      if (it.done) it.focusAt = null;
      return it;
    }
    case "edit": {
      const it = item(d, op.id);
      if (op.text !== undefined) {
        const pr = splitPriority(str(op.text));
        const parts = splitLinks(pr.text);
        if (!parts.text) throw new Error("An item needs some text.");
        it.text = parts.text;
        if (pr.priority) it.priority = pr.priority;
        it.links = normalizeLinks([...it.links, ...parts.links]);
      }
      if (op.project !== undefined) {
        const p = findProject(d, op.project);
        if (p) it.project = p.id;
      }
      return it;
    }
    case "focus": {
      // One item at a time: starting one stops whatever was in focus before.
      const it = item(d, op.id);
      const on = op.on === undefined ? !it.focusAt : !!op.on;
      for (const x of d.items) x.focusAt = null;
      if (on && !it.done) it.focusAt = new Date().toISOString();
      return it;
    }
    case "priority": {
      const it = item(d, op.id);
      it.priority = priority(op.priority);
      return it;
    }
    case "link": {
      const it = item(d, op.id);
      it.links = normalizeLinks([...it.links, { url: op.url, label: op.label }]);
      return it;
    }
    case "unlink": {
      const it = item(d, op.id);
      it.links = it.links.filter((l) => l.url !== op.url);
      return it;
    }
    case "restore": {
      // Puts back an item exactly as it was (the undo after a delete).
      const it = normalize({ projects: d.projects, items: [op.item] }).items[0];
      if (it && !d.items.some((i) => i.id === it.id)) d.items.push(it);
      return it || null;
    }
    case "delete": {
      const before = d.items.length;
      d.items = d.items.filter((i) => i.id !== op.id);
      return before !== d.items.length;
    }
    case "clear-done": {
      const before = d.items.length;
      d.items = d.items.filter((i) => !i.done);
      return before - d.items.length;
    }
    case "project-add":
      return addProject(d, op);
    case "project-edit": {
      const p = findProject(d, op.id);
      if (!p) throw new Error("That project no longer exists.");
      for (const k of ["name", "projectId", "dashboard", "keywords"]) {
        if (op[k] !== undefined) p[k] = str(op[k]);
      }
      if (!p.name) p.name = p.id === "general" ? "General" : "Untitled";
      return p;
    }
    case "project-move": {
      const i = d.projects.findIndex((p) => p.id === op.id);
      const j = i + (op.by > 0 ? 1 : -1);
      if (i < 1 || j < 1 || j >= d.projects.length) return false; // General stays first
      [d.projects[i], d.projects[j]] = [d.projects[j], d.projects[i]];
      return true;
    }
    case "project-delete": {
      if (op.id === "general") throw new Error("General cannot be deleted.");
      d.projects = d.projects.filter((p) => p.id !== op.id);
      for (const it of d.items) if (it.project === op.id) it.project = "general";
      return true;
    }
    default:
      throw new Error(`Unknown change: ${op && op.type}`);
  }
}

module.exports = { VERSION, PRIORITIES, emptyData, normalize, read, write, load, apply, addItems, splitLinks, splitPriority, findProject, slug, ReadError };
