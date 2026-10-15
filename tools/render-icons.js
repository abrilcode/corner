// Draws the app icon and the menu-bar icon with Electron itself (no image
// tools needed): node_modules/.bin/electron tools/render-icons.js
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
// App icon: a sheet of paper with one folded-over corner in flat colour.
const appSvg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="185" fill="#fbfbfa"/>
  <rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#e2e2de" stroke-width="3"/>
  <path d="M300 262 H612 L724 374 V762 H300 Z" fill="none" stroke="#1c1d1f" stroke-width="22" stroke-linejoin="round"/>
  <path d="M612 262 V374 H724 Z" fill="#c9d3ea" stroke="#1c1d1f" stroke-width="22" stroke-linejoin="round"/>
  <path d="M372 470 H560 M372 556 H640 M372 642 H510" stroke="#1c1d1f" stroke-width="18" stroke-linecap="round"/>
</svg>`;
// Menu-bar icon (template image: black with alpha, macOS tints it).
const traySvg = (s) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 18 18">
  <path d="M4 2.8 H10.6 L14 6.2 V15.2 H4 Z" fill="none" stroke="#000" stroke-width="1.35" stroke-linejoin="round"/>
  <path d="M10.6 2.8 V6.2 H14 Z" fill="#000"/>
  <path d="M6.3 8.8 H10.6 M6.3 11.6 H11.4" stroke="#000" stroke-width="1.2" stroke-linecap="round"/>
</svg>`;

// Everything is drawn at 512 px and scaled down, so small icons stay crisp.
const CANVAS = 512;
async function render(svgFor, size, file) {
  const w = new BrowserWindow({ width: CANVAS, height: CANVAS, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadURL(`data:text/html,${encodeURIComponent(`<html><body style="margin:0;background:transparent">${svgFor(CANVAS)}</body></html>`)}`);
  await new Promise((r) => setTimeout(r, 250));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: CANVAS, height: CANVAS });
  fs.writeFileSync(file, img.resize({ width: size, height: size, quality: "best" }).toPNG());
  w.destroy();
  console.log("wrote", path.relative(root, file));
}

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {}); // keep going between icons
app.whenReady().then(async () => {
  await render(appSvg, 1024, path.join(root, "build", "icon.png"));
  await render(traySvg, 18, path.join(root, "tray", "trayTemplate.png"));
  await render(traySvg, 36, path.join(root, "tray", "trayTemplate@2x.png"));
  app.quit();
});
