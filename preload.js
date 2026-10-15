// The bridge between the window and the app. The page only gets these calls.

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("corner", {
  load: () => ipcRenderer.invoke("corner:load"),
  op: (op) => ipcRenderer.invoke("corner:op", op),
  sort: (dump) => ipcRenderer.invoke("corner:sort", dump),
  cancelSort: () => ipcRenderer.invoke("corner:sort-cancel"),
  open: (target) => ipcRenderer.invoke("corner:open", target),
  copy: (text) => ipcRenderer.invoke("corner:copy", text),
  mini: (on) => ipcRenderer.send("corner:mini", !!on),
  move: (corner) => ipcRenderer.send("corner:move", corner),
  itemMenu: (id) => ipcRenderer.send("corner:menu-item", id),
  projectMenu: (id) => ipcRenderer.send("corner:menu-project", id),
  proposalMenu: (index, project, priority) => ipcRenderer.send("corner:menu-proposal", { index, project, priority }),
  appMenu: () => ipcRenderer.send("corner:menu-tray"),
  rendered: () => ipcRenderer.send("corner:rendered"),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ""; } },
  onData: (fn) => ipcRenderer.on("corner:data", (_e, d) => fn(d)),
  onAction: (fn) => ipcRenderer.on("corner:action", (_e, a) => fn(a)),
  onMini: (fn) => ipcRenderer.on("corner:mini", (_e, on) => fn(!!on)),
  onFocusDump: (fn) => ipcRenderer.on("corner:focus-dump", () => fn()),
});
