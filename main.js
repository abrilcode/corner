// Corner: a small window that stays on top of everything (browser, terminal,
// full-screen apps) with the open action items of every project. It can be
// dragged anywhere and sticks to the screen edges and corners; a brain dump
// goes to Claude Code, which splits it into items per project.
//
// The list is one JSON file shared with Claude Code (see lib/store.js and
// the corner skill), and the window follows that file live.

const { app, BrowserWindow, Menu, Tray, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, net, powerMonitor, protocol, screen, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const store = require("./lib/store");
const sorter = require("./lib/sorter");
const place = require("./lib/place");

const WEB = path.join(__dirname, "web");
const DATA_FILE = process.env.CORNER_DATA || path.join(os.homedir(), ".corner", "corner.json");
const DATA_DIR = path.dirname(DATA_FILE);
const TEST = process.env.CORNER_TEST === "1";
const SHOT = process.env.CORNER_SHOT || "";
const WIDTH = 292, HEIGHT = 440, MINI = 46;
const SHORTCUT = "Control+Alt+Space";
const REPO = "https://github.com/abrilcode/corner";

protocol.registerSchemesAsPrivileged([
  { scheme: "corner", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

if (!TEST && !app.requestSingleInstanceLock()) app.quit();
if (TEST) app.setPath("userData", path.join(DATA_DIR, "test-user-data"));

let win = null;
let tray = null;
let quitting = false;
let job = null; // the running Claude sort, if any
const log = (...a) => { if (TEST) console.log("[corner]", ...a); };

// ---- window state (position, mini mode, theme) --------------------------

const stateFile = () => path.join(app.getPath("userData"), "window.json");
let ui = { bounds: null, height: HEIGHT, mini: false, theme: "system", loginSet: false, lastDay: "" };

function loadUi() {
  try { ui = { ...ui, ...JSON.parse(fs.readFileSync(stateFile(), "utf8")) }; } catch { /* first run */ }
}
function saveUi() {
  try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(ui, null, 2)); } catch { /* not fatal */ }
}

const areaFor = (b) => screen.getDisplayMatching(b).workArea;

// ---- data ---------------------------------------------------------------

const seed = () => JSON.parse(fs.readFileSync(path.join(__dirname, "lib", "seed.json"), "utf8"));

function readData() {
  try {
    return { data: store.load(DATA_FILE, seed()), error: null };
  } catch (e) {
    return { data: null, error: e.message };
  }
}

function change(op) {
  try {
    const d = store.load(DATA_FILE, seed());
    const result = store.apply(d, op);
    store.write(DATA_FILE, d);
    return { data: d, result };
  } catch (e) {
    return { error: e.message, ...readData() };
  }
}

let watchTimer = null;
function watchData() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Watch the folder, not the file: atomic writes replace the file.
  fs.watch(DATA_DIR, (_ev, name) => {
    if (name && name !== path.basename(DATA_FILE)) return;
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send("corner:data", readData());
      log("file changed");
    }, 120);
  });
}

// ---- the window ---------------------------------------------------------

function bg() {
  const dark = ui.theme === "dark" || (ui.theme === "system" && nativeTheme.shouldUseDarkColors);
  return dark ? "#17181a" : "#fbfbfa";
}

function createWindow() {
  const primary = screen.getPrimaryDisplay().workArea;
  let b = ui.bounds;
  if (!b || !screen.getAllDisplays().some((dsp) => {
    const a = dsp.workArea;
    return b.x >= a.x - 20 && b.y >= a.y - 20 && b.x + 40 <= a.x + a.width && b.y + 40 <= a.y + a.height;
  })) {
    b = place.cornerBounds("top-right", { width: WIDTH, height: ui.mini ? MINI : ui.height }, primary);
  }

  win = new BrowserWindow({
    ...b, show: false, frame: false, resizable: !ui.mini, minWidth: 250, maxWidth: 560, minHeight: MINI,
    fullscreenable: false, maximizable: false, minimizable: false, skipTaskbar: true,
    alwaysOnTop: true, backgroundColor: bg(), title: "Corner", hasShadow: true,
    acceptFirstMouse: true, // a click while another app is in front still ticks the item
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true,
    },
  });
  // "floating" sits above normal windows; visibleOnFullScreen keeps it there
  // over full-screen apps and on every desktop (Space).
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const query = SHOT ? `?shot=${encodeURIComponent(process.env.CORNER_SHOT_STATE || "list")}` : "";
  win.loadURL(`corner://app/index.html${query}`);

  win.on("moved", () => {
    const now = win.getBounds();
    const snapped = place.snap(now, areaFor(now));
    if (snapped.x !== now.x || snapped.y !== now.y) win.setBounds(snapped);
    ui.bounds = snapped;
    saveUi();
  });
  win.on("resized", () => {
    const now = win.getBounds();
    if (!ui.mini) ui.height = now.height;
    ui.bounds = now;
    saveUi();
  });
  win.on("close", (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });

  win.webContents.setWindowOpenHandler(({ url }) => { openTarget(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => {
    if (url.startsWith("corner://app/")) return;
    e.preventDefault();
    openTarget(url);
  });
}

function moveTo(corner) {
  const b = win.getBounds();
  const nb = place.cornerBounds(corner, { width: b.width, height: b.height }, areaFor(b));
  log("move", corner, JSON.stringify(nb));
  win.setBounds(nb);
  ui.bounds = nb;
  saveUi();
  if (!win.isVisible()) win.show();
}

function setMini(on) {
  ui.mini = !!on;
  const b = win.getBounds();
  const nb = place.resizeAnchored(b, ui.mini ? MINI : ui.height, areaFor(b));
  win.setResizable(true);
  win.setBounds(nb);
  win.setResizable(!ui.mini);
  ui.bounds = nb;
  saveUi();
  win.webContents.send("corner:mini", ui.mini);
}

function showAndFocus() {
  win.show();
  win.focus();
  if (ui.mini) setMini(false);
  win.webContents.send("corner:focus-dump");
}

// The shortcut: hidden → show with the cursor in the dump; shown but in the
// background → bring the cursor to it; already focused → hide.
function onShortcut() {
  if (win.isVisible() && win.isFocused()) win.hide();
  else showAndFocus();
}

// The menu-bar icon: a plain show / hide.
function toggleVisible() {
  if (win.isVisible()) win.hide();
  else { win.showInactive(); }
}

function setTheme(theme) {
  ui.theme = theme;
  nativeTheme.themeSource = theme;
  win.setBackgroundColor(bg());
  saveUi();
}

// ---- opening links ------------------------------------------------------

function expand(p) {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

async function openTarget(target) {
  const t = String(target || "").trim();
  if (!t) return { ok: false };
  if (/^(https?|mailto|slack|notion|vscode|cursor|obsidian):/i.test(t)) {
    await shell.openExternal(t);
    return { ok: true };
  }
  const file = expand(t.replace(/^file:\/\//, ""));
  if (fs.existsSync(file)) {
    const err = await shell.openPath(file);
    return { ok: !err, error: err || null };
  }
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) { // a bare domain like docs.google.com/...
    await shell.openExternal(`https://${t}`);
    return { ok: true };
  }
  return { ok: false, error: `Not found: ${t}` };
}

// ---- menus --------------------------------------------------------------

function projectSubmenu(d, current, pick) {
  return d.projects.map((p) => ({ label: p.name, type: "radio", checked: p.id === current, click: () => pick(p.id) }));
}

function priorityMenu(current, pick) {
  return [["P0", "P0"], ["P1", "P1"], ["None", ""]].map(([label, p]) => ({ label, type: "radio", checked: (current || "") === p, click: () => pick(p) }));
}

function itemMenu(id) {
  const { data: d } = readData();
  const it = d && d.items.find((i) => i.id === id);
  if (!it) return;
  const send = (action, extra = {}) => win.webContents.send("corner:action", { action, id, ...extra });
  const tpl = [
    ...(it.done ? [] : [{ label: it.focusAt ? "Stop working on it" : "Start working on it", click: () => send("changed", change({ type: "focus", id })) }]),
    { label: "Edit", click: () => send("edit") },
    { label: "Add a link…", click: () => send("link") },
    ...(it.links.length ? [{ label: "Remove link", submenu: it.links.map((l) => ({ label: l.label || l.url, click: () => send("changed", change({ type: "unlink", id, url: l.url })) })) }] : []),
    { label: "Priority", submenu: priorityMenu(it.priority, (p) => send("changed", change({ type: "priority", id, priority: p }))) },
    { label: "Move to", submenu: projectSubmenu(d, it.project, (pid) => send("changed", change({ type: "edit", id, project: pid }))) },
    { label: "Copy text", click: () => clipboard.writeText([it.text, ...it.links.map((l) => l.url)].join("\n")) },
    { type: "separator" },
    { label: it.done ? "Mark as open" : "Mark as done", click: () => send("changed", change({ type: "toggle", id })) },
    { label: "Delete", click: () => send("deleted", { item: it, ...change({ type: "delete", id }) }) },
  ];
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

function projectMenu(id) {
  const { data: d } = readData();
  const p = d && d.projects.find((x) => x.id === id);
  if (!p) return;
  const send = (action, extra = {}) => win.webContents.send("corner:action", { action, id, ...extra });
  const i = d.projects.indexOf(p);
  const tpl = [
    { label: "Add an item", click: () => send("add") },
    { label: "Edit project…", click: () => send("edit-project") },
    ...(p.dashboard ? [{ label: "Open dashboard", click: () => openTarget(p.dashboard) }] : []),
    ...(p.projectId ? [{ label: "Copy project ID", click: () => clipboard.writeText(p.projectId) }] : []),
    { type: "separator" },
    { label: "Move up", enabled: i > 1, click: () => send("changed", change({ type: "project-move", id, by: -1 })) },
    { label: "Move down", enabled: i > 0 && i < d.projects.length - 1, click: () => send("changed", change({ type: "project-move", id, by: 1 })) },
    ...(p.id === "general" ? [] : [
      { type: "separator" },
      {
        label: "Delete project…",
        click: async () => {
          const open = d.items.filter((x) => x.project === id && !x.done).length;
          const { response } = await dialog.showMessageBox(win, {
            type: "question", buttons: ["Delete", "Cancel"], defaultId: 1, cancelId: 1,
            message: `Delete ${p.name}?`,
            detail: open ? `Its ${open} open item${open === 1 ? "" : "s"} move to General.` : "It has no open items.",
          });
          if (response === 0) send("changed", change({ type: "project-delete", id }));
        },
      },
    ]),
  ];
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

function proposalMenu(index, current, prio) {
  const { data: d } = readData();
  if (!d) return;
  const tpl = [
    { label: "Priority", submenu: priorityMenu(prio, (p) => win.webContents.send("corner:action", { action: "proposal-priority", index, priority: p })) },
    { label: "Move to", submenu: projectSubmenu(d, current, (pid) => win.webContents.send("corner:action", { action: "proposal-project", index, project: pid })) },
    { label: "Leave out", click: () => win.webContents.send("corner:action", { action: "proposal-drop", index }) },
  ];
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

function trayMenu() {
  const login = app.getLoginItemSettings().openAtLogin;
  const corners = [["Top left", "top-left"], ["Top right", "top-right"], ["Bottom left", "bottom-left"], ["Bottom right", "bottom-right"]];
  return Menu.buildFromTemplate([
    { label: win && win.isVisible() ? "Hide Corner" : "Show Corner", accelerator: SHORTCUT, click: toggleVisible },
    { label: "Write a brain dump", click: showAndFocus },
    { label: "Mini", type: "checkbox", checked: ui.mini, click: (m) => setMini(m.checked) },
    { label: "Move to", submenu: corners.map(([label, c]) => ({ label, click: () => moveTo(c) })) },
    { label: "Appearance", submenu: [["Match the system", "system"], ["Light", "light"], ["Dark", "dark"]].map(([label, t]) => ({ label, type: "radio", checked: ui.theme === t, click: () => setTheme(t) })) },
    { type: "separator" },
    { label: "Show the list file", click: () => shell.showItemInFolder(DATA_FILE) },
    { label: "About Corner", click: () => shell.openExternal(REPO) },
    { label: "Open at login", type: "checkbox", checked: login, enabled: app.isPackaged, click: (m) => app.setLoginItemSettings({ openAtLogin: m.checked }) },
    { type: "separator" },
    { label: "Quit Corner", accelerator: "Command+Q", click: () => { quitting = true; app.quit(); } },
  ]);
}

function trayIcon() {
  const img = nativeImage.createFromPath(path.join(__dirname, "tray", "trayTemplate.png"));
  img.setTemplateImage(true);
  return img;
}

// ---- Claude Code skill ----------------------------------------------------
// When Claude Code is on this Mac (~/.claude exists), the corner skill that
// ships inside the app is installed, so any chat can add to the list. It is
// rewritten only when the app version changes.

function installSkill() {
  const home = process.env.CORNER_CLAUDE_HOME || path.join(os.homedir(), ".claude");
  if (!fs.existsSync(home)) return "no Claude Code";
  const dest = path.join(home, "skills", "corner");
  const marker = path.join(dest, ".corner-version");
  try {
    if (fs.readFileSync(marker, "utf8").trim() === app.getVersion()) return "current";
  } catch { /* not installed yet */ }
  const src = path.join(__dirname, "skill");
  fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dest, "SKILL.md"), fs.readFileSync(path.join(src, "SKILL.md")));
  fs.writeFileSync(path.join(dest, "scripts", "corner.py"), fs.readFileSync(path.join(src, "scripts", "corner.py")), { mode: 0o755 });
  fs.writeFileSync(marker, app.getVersion());
  return "installed";
}

/** A small record of how this launch went, for support: ~/Library/Application Support/Corner/status.json */
function writeStatus(extra) {
  try {
    const login = app.getLoginItemSettings();
    fs.writeFileSync(path.join(app.getPath("userData"), "status.json"), JSON.stringify({
      at: new Date().toISOString(), version: app.getVersion(), packaged: app.isPackaged,
      openAtLogin: login.openAtLogin, loginStatus: login.status || null, list: DATA_FILE, ...extra,
    }, null, 2));
  } catch { /* not fatal */ }
}

// The window comes back on its own the first time the Mac is used each day,
// even if it was hidden the day before.
const today = () => new Date().toLocaleDateString("en-CA");
function newDay() {
  if (ui.lastDay === today()) return;
  ui.lastDay = today();
  saveUi();
  if (win && !win.isDestroyed() && !win.isVisible()) win.showInactive();
}

// ---- bridge -------------------------------------------------------------

ipcMain.handle("corner:load", () => {
  const res = readData();
  const claude = !!sorter.findClaude(res.data && res.data.settings.claudePath);
  return { ...res, file: DATA_FILE, mini: ui.mini, shortcut: "⌃⌥Space", claude };
});
ipcMain.handle("corner:op", (_e, op) => change(op));
ipcMain.handle("corner:sort", async (_e, dump) => {
  const { data: d, error } = readData();
  if (!d) return { error };
  if (job) job.cancel();
  job = sorter.sort(d, String(dump || ""), { claudePath: d.settings.claudePath, model: d.settings.model || "sonnet", cwd: DATA_DIR });
  const mine = job;
  try {
    const res = await mine.promise;
    log("sorted", res.items.length, "items", res.costUsd);
    return res;
  } catch (e) {
    return { error: e.message };
  } finally {
    if (job === mine) job = null;
  }
});
ipcMain.handle("corner:sort-cancel", () => { if (job) job.cancel(); job = null; return true; });
ipcMain.handle("corner:open", (_e, target) => openTarget(target));
ipcMain.handle("corner:copy", (_e, text) => { clipboard.writeText(String(text || "")); return true; });
ipcMain.on("corner:mini", (_e, on) => setMini(on));
ipcMain.on("corner:move", (_e, corner) => { if (place.CORNERS.includes(corner)) moveTo(corner); });
ipcMain.on("corner:menu-item", (_e, id) => itemMenu(id));
ipcMain.on("corner:menu-project", (_e, id) => projectMenu(id));
ipcMain.on("corner:menu-proposal", (_e, { index, project, priority }) => proposalMenu(index, project, priority));
ipcMain.on("corner:menu-tray", () => trayMenu().popup({ window: win }));
ipcMain.on("corner:rendered", async () => {
  if (!SHOT) return;
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(SHOT, img.toPNG());
  log("shot", SHOT, img.getSize());
  quitting = true;
  app.quit();
});

app.on("second-instance", showAndFocus);
app.on("window-all-closed", (e) => e.preventDefault());
app.on("before-quit", () => { quitting = true; });
app.on("will-quit", () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  protocol.handle("corner", (req) => {
    const { host, pathname } = new URL(req.url);
    const file = path.normalize(path.join(WEB, decodeURIComponent(pathname)));
    if (host !== "app" || !file.startsWith(WEB + path.sep)) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  loadUi();
  if (SHOT) {
    ui = { ...ui, bounds: null, mini: /mini$/.test(process.env.CORNER_SHOT_STATE || ""), height: Number(process.env.CORNER_SHOT_HEIGHT) || HEIGHT, theme: "light" };
  }
  if (process.env.CORNER_THEME) ui.theme = process.env.CORNER_THEME;
  nativeTheme.themeSource = ui.theme;
  if (process.platform === "darwin") app.dock?.hide();

  // The first time the installed app runs it adds itself to the login items,
  // so the window is there every morning. The tray menu turns this off.
  if (app.isPackaged && !ui.loginSet) {
    app.setLoginItemSettings({ openAtLogin: true });
    ui.loginSet = true;
    saveUi();
  }

  createWindow();
  watchData();
  if (!TEST || process.env.CORNER_CLAUDE_HOME) {
    let skill;
    try { skill = installSkill(); } catch (e) { skill = `failed: ${e.message}`; }
    writeStatus({ skill, claude: sorter.findClaude() });
    log("skill", skill);
  }
  if (!SHOT) {
    ui.lastDay = today();
    saveUi();
    powerMonitor.on("unlock-screen", newDay);
    powerMonitor.on("resume", newDay);
    setInterval(newDay, 20 * 60 * 1000);
  }

  if (!SHOT) {
    tray = new Tray(trayIcon());
    tray.setToolTip("Corner");
    tray.on("click", toggleVisible);
    tray.on("right-click", () => tray.popUpContextMenu(trayMenu()));
    if (!globalShortcut.register(SHORTCUT, onShortcut)) log("shortcut taken", SHORTCUT);
  }

  screen.on("display-removed", () => {
    const b = win.getBounds();
    win.setBounds(place.snap(b, screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea));
  });

  win.once("ready-to-show", () => { win.showInactive(); log("ready"); });

  if (TEST && process.env.CORNER_E2E) {
    win.webContents.once("did-finish-load", async () => {
      const failed = await require(process.env.CORNER_E2E)(win, DATA_FILE).catch((e) => { console.error(e); return 1; });
      quitting = true;
      app.exit(failed ? 1 : 0);
    });
  }
});
