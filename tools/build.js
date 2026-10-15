// electron-builder through its API (its CLI misreads arguments when run on
// Electron's Node). Builds dist/mac-arm64/Corner.app from package.json "build";
// `tools/bin/node tools/build.js zip` also makes the release zip for this Mac.
const builder = require("electron-builder");

builder.build({
  targets: builder.Platform.MAC.createTarget(process.argv[2] === "zip" ? ["dir", "zip"] : "dir", builder.Arch.arm64),
  publish: "never",
}).then((out) => console.log("built", out.join(", ") || "dist/mac-arm64/Corner.app"))
  .catch((e) => { console.error(e); process.exit(1); });
