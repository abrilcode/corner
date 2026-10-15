// Draws the app icon and the menu-bar icon with Electron itself (no image
// tools needed): tools/bin/node is not needed, run
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron tools/render-icons.js [variant] [outDir]
// The mark is a cursive C in Newsreader italic, the face of the "Corner" wordmark.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..");
const FONT = path.join(root, "web", "fonts", "newsreader-italic.woff2");
const PAPER = "#fbfbfa", INK = "#1c1d1f", RULE = "#e2e2de", TINT = "#c9d3ea";

// Each variant draws on a 1024 canvas. "plain" = the C alone; "tint" = the C
// over a flat disc of the app's muted blue, offset like a print register;
// "corner" = the C with a folded blue corner, the first icon's motif.
const VARIANTS = {
  plain: () => "",
  tint: () => `<circle cx="548" cy="480" r="232" fill="${TINT}"/>`,
  corner: () => `<path d="M724 100 H739 A185 185 0 0 1 924 285 V300 Z" fill="${TINT}"/>`,
};

const appIcon = (variant) => `
  <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <rect x="100" y="100" width="824" height="824" rx="185" fill="${PAPER}"/>
    ${VARIANTS[variant]()}
    <rect x="101.5" y="101.5" width="821" height="821" rx="184" fill="none" stroke="${RULE}" stroke-width="3"/>
    <text x="500" y="742" text-anchor="middle" font-family="Newsreader" font-style="italic" font-weight="400" font-size="700" fill="${INK}">C</text>
  </svg>`;

// Menu-bar icon: a template image (black with alpha; macOS tints it).
const trayIcon = () => `
  <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <text x="500" y="850" text-anchor="middle" font-family="Newsreader" font-style="italic" font-weight="500" font-size="1060" fill="#000">C</text>
  </svg>`;

const CANVAS = 1024;
async function render(svg, size, file) {
  const html = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "corner-icon-")), "icon.html");
  fs.writeFileSync(html, `<!doctype html><html><head><style>
    @font-face { font-family: "Newsreader"; font-style: italic; src: url("${pathUrl(FONT)}") format("woff2"); }
    html, body { margin: 0; background: transparent; } svg { display: block; }
  </style></head><body>${svg}</body></html>`);
  const w = new BrowserWindow({ width: CANVAS, height: CANVAS, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await w.loadFile(html);
  await w.webContents.executeJavaScript("document.fonts.ready.then(() => document.fonts.check('italic 100px Newsreader'))").then((ok) => { if (!ok) throw new Error("Newsreader italic did not load"); });
  await new Promise((r) => setTimeout(r, 200));
  const img = await w.webContents.capturePage({ x: 0, y: 0, width: CANVAS, height: CANVAS });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, img.resize({ width: size, height: size, quality: "best" }).toPNG());
  w.destroy();
  console.log("wrote", file);
}
const pathUrl = (p) => `file://${p.split(path.sep).map(encodeURIComponent).join("/")}`;

app.disableHardwareAcceleration();
app.on("window-all-closed", () => {}); // keep going between icons
app.whenReady().then(async () => {
  const variant = process.argv[2] && VARIANTS[process.argv[2]] ? process.argv[2] : "plain";
  const out = process.argv[3] ? path.resolve(process.argv[3]) : null;
  if (out) {
    // Preview only: every variant into outDir.
    for (const v of Object.keys(VARIANTS)) await render(appIcon(v), 512, path.join(out, `icon-${v}.png`));
    await render(trayIcon(), 36, path.join(out, "tray@2x.png"));
  } else {
    await render(appIcon(variant), 1024, path.join(root, "build", "icon.png"));
    await render(trayIcon(), 18, path.join(root, "tray", "trayTemplate.png"));
    await render(trayIcon(), 36, path.join(root, "tray", "trayTemplate@2x.png"));
  }
  app.quit();
});
