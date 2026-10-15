// "Sort with Claude": the brain dump goes to Claude Code in headless mode
// (claude -p) with no tools, and comes back as structured action items,
// one project each. Nothing is saved here; the window shows the proposal
// first and only adds what is kept.

const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sortLocally } = require("./localsort");

const SYSTEM = `You turn one person's brain dump into a short, clear to-do list.

Rules:
- One action per item. Start with a verb. Keep the person's own words, names and language. Keep each item under 110 characters.
- Only things to do. Skip feelings and background unless they imply an action. Never invent work that is not in the dump.
- Assign every item to one project id from the list, using names, keywords and context. If nothing fits, use "general".
- If the dump clearly names a project that is not on the list, use "new" and put the project's name in newProject.
- Put every URL, document name or file path that belongs to an item in that item's links, exactly as written. Leave links empty otherwise.
- Priority: "P0" only when the dump says it is urgent, a blocker, ASAP or P0; "P1" when it says P1 or important/soon; otherwise "none". Most items have none.
- Do not repeat items that are already open on the list.
- If the dump has nothing to do in it, return an empty list.`;

function schema(projectIds) {
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            project: { type: "string", enum: [...projectIds, "new"] },
            newProject: { type: "string" },
            text: { type: "string" },
            links: { type: "array", items: { type: "string" } },
            priority: { type: "string", enum: ["P0", "P1", "none"] },
          },
          required: ["project", "text", "links", "priority"],
        },
      },
    },
    required: ["items"],
  };
}

function message(data, dump, today = new Date()) {
  const lines = [`Today: ${today.toISOString().slice(0, 10)}`, "", "Projects:"];
  for (const p of data.projects) {
    const bits = [`id: ${p.id}`, `name: ${p.name}`];
    if (p.projectId) bits.push(`project ID ${p.projectId}`);
    if (p.keywords) bits.push(`keywords: ${p.keywords}`);
    lines.push(`- ${bits.join(" · ")}`);
  }
  const open = data.items.filter((i) => !i.done);
  if (open.length) {
    lines.push("", "Already open (do not repeat):");
    for (const i of open) lines.push(`- [${i.project}] ${i.text}`);
  }
  lines.push("", "Brain dump:", '"""', dump.trim(), '"""');
  return lines.join("\n");
}

/** Maps Claude's answer back onto real projects; unknown ids fall to General. */
function proposals(data, out) {
  const ids = new Set(data.projects.map((p) => p.id));
  const list = out && Array.isArray(out.items) ? out.items : [];
  return list
    .map((i) => {
      const text = typeof i.text === "string" ? i.text.trim() : "";
      const links = Array.isArray(i.links) ? i.links.filter((l) => typeof l === "string" && l.trim()) : [];
      const newProject = i.project === "new" && typeof i.newProject === "string" ? i.newProject.trim() : "";
      const existing = newProject && data.projects.find((p) => p.name.toLowerCase() === newProject.toLowerCase());
      const project = existing ? existing.id : ids.has(i.project) ? i.project : "general";
      const priority = i.priority === "P0" || i.priority === "P1" ? i.priority : "";
      return { project, newProject: existing ? "" : newProject, text, links, priority };
    })
    .filter((i) => i.text);
}

// ---- finding claude -----------------------------------------------------
// An app opened from the Finder does not get the terminal's PATH, so the
// login shell is asked once and the usual install places are checked.

let shellPath = null;
function loginPath() {
  if (shellPath !== null) return shellPath;
  try {
    const sh = process.env.SHELL || "/bin/zsh";
    shellPath = execFileSync(sh, ["-ilc", 'printf "%s" "$PATH"'], { timeout: 4000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    shellPath = "";
  }
  return shellPath;
}

function envPath() {
  const home = os.homedir();
  const extra = [path.join(home, ".local/bin"), path.join(home, ".claude/local"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set([...loginPath().split(":"), ...(process.env.PATH || "").split(":"), ...extra].filter(Boolean))].join(":");
}

function findClaude(configured) {
  if (process.env.CORNER_NO_CLAUDE === "1") return null; // tests: behave like a Mac without Claude Code
  if (configured && fs.existsSync(configured)) return configured;
  for (const dir of envPath().split(":")) {
    const p = path.join(dir, "claude");
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch { /* keep looking */ }
  }
  return null;
}

/**
 * Runs the sort. Returns { promise, cancel }. The promise resolves to
 * { items } or rejects with a message fit to show in the window.
 */
function sort(data, dump, { claudePath, model = "sonnet", cwd, timeoutMs = 120000 } = {}) {
  let child = null;
  let cancelled = false;
  const promise = new Promise((resolve, reject) => {
    const bin = findClaude(claudePath);
    // Without Claude Code the dump is still sorted, by project names and keywords.
    if (!bin) return resolve({ items: sortLocally(data, dump), local: true, costUsd: 0 });
    const args = [
      "-p", "--model", model, "--tools", "", "--strict-mcp-config", "--disable-slash-commands",
      "--no-session-persistence", "--setting-sources", "", "--output-format", "json",
      "--json-schema", JSON.stringify(schema(data.projects.map((p) => p.id))),
      "--system-prompt", SYSTEM,
    ];
    if (cwd) fs.mkdirSync(cwd, { recursive: true });
    child = spawn(bin, args, { cwd: cwd || os.homedir(), env: { ...process.env, PATH: envPath() }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error("Claude took too long. Try again, or split the dump.")); }, timeoutMs);
    child.stdout.on("data", (b) => { out += b; });
    child.stderr.on("data", (b) => { err += b; });
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`Claude Code could not start: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (cancelled) return reject(new Error("cancelled"));
      let res = null;
      try { res = JSON.parse(out); } catch { /* handled below */ }
      if (code !== 0 || !res || res.is_error) {
        const why = (res && (res.result || res.error)) || err.trim().split("\n").pop() || `exit code ${code}`;
        return reject(new Error(`Claude could not sort this: ${String(why).slice(0, 200)}`));
      }
      let structured = res.structured_output;
      if (!structured && typeof res.result === "string") {
        try { structured = JSON.parse(res.result.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { /* handled below */ }
      }
      if (!structured) return reject(new Error("Claude answered, but not as a list. Try again."));
      resolve({ items: proposals(data, structured), costUsd: res.total_cost_usd || 0 });
    });
    child.stdin.end(message(data, dump));
  });
  return {
    promise,
    cancel: () => { cancelled = true; if (child) child.kill("SIGTERM"); },
  };
}

module.exports = { SYSTEM, schema, message, proposals, findClaude, envPath, sort };
