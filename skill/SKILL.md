---
name: corner
description: The user's action-item list, shown in the Corner window that floats on their screen. Use whenever they drop a brain dump and want it split into action items per project, say "add to my list / my corner / my to-dos / remind me to / action items / second brain", ask what is open on their list or for a project, mark something done ("done with X", "I sent it"), set a priority (P0 or P1), link a doc to an item, or add or edit a project (its project ID or dashboard). Also use when, inside any project chat, they say "add an action item for this".
---

# Corner

Corner is a small always-on-top window (https://github.com/abrilcode/corner) that lists open action items by project. The list is ONE JSON file, `~/.corner/corner.json`, and the window redraws by itself when that file changes. This skill is installed and kept up to date by the Corner app.

Never edit the JSON by hand. Use the helper, which re-reads the file, writes it atomically and keeps `corner.json.bak`:

```
CORNER=~/.claude/skills/corner/scripts/corner.py
python3 $CORNER list            # projects (id, project ID, dashboard) + open items with ids and priorities
python3 $CORNER list --json     # the same, as JSON
python3 $CORNER list --done     # finished items
python3 $CORNER add "text" --project <id or name> [--priority P0|P1] [--link URL_or_path ...]
python3 $CORNER add-json <<'JSON'
{"items":[{"project":"website","text":"Ask Maya for the hero photo","priority":"P0","links":[]}]}
JSON
python3 $CORNER done <id> [<id> ...]     python3 $CORNER reopen <id>
python3 $CORNER edit <id> [--text "..."] [--project <id or name>] [--priority P0|P1|none]
python3 $CORNER link <id> <url or path>  python3 $CORNER delete <id>
python3 $CORNER project add "Name" [--project-id X] [--dashboard URL] [--keywords "a, b"]
python3 $CORNER project edit <id> [--name] [--project-id] [--dashboard] [--keywords]
```

## Brain dump → items (the main job)

1. Run `list --json` first, to see the projects (with their keywords) and what is already open.
2. Split the dump using the same rules as the window's "Sort with Claude":
   - one action per item, starting with a verb, in the user's words and language, under ~110 characters;
   - only things to do: skip feelings and background unless they imply an action, and never invent work;
   - assign each item by project name, keywords, people and context; anything that fits no project goes to `general`;
   - a project they clearly name that is not on the list → `"project": "new", "newProject": "Name"` (it is created);
   - priority: only two levels. `P0` when the dump says urgent, blocker, ASAP or P0; `P1` when it says P1, important or soon; otherwise leave it out. Most items have none;
   - every URL, doc name or file path that belongs to an item goes in that item's `links`;
   - skip anything already open on the list.
3. Add everything in ONE `add-json` call.
4. Reply briefly, grouped by project, one line per item (with P0/P1 if set), without ids. If an assignment was a guess, say so in one line ("put X under General, no project matched").

## Other requests

- "What's open?" or "what's on Website?" → `list` (P0 first), then answer with only the items asked about.
- "Done with X" or "I sent it" → find the item in `list`, run `done <id>`, and confirm in one line. If several items could match, ask which one.
- "Make X a P0" → `edit <id> --priority P0`. "No priority" → `--priority none`.
- "Link this doc to X" → `link <id> <url>`. File paths can be `~/…`; the window opens them in the Finder's default app.
- In a project chat, "add an action item for this" → pick the project from the working folder and the conversation (keywords help). Ask only if that is genuinely unclear.
- A new project with a project ID or a dashboard → `project add` with `--project-id` and `--dashboard`. The window shows the ID (click to copy) and opens the dashboard from the project name.

## Do not

- Do not delete items or projects unless asked; `done` is the normal way to clear an item.
- Do not paste the whole list back after adding something. Confirm only what changed.
- Do not touch `settings` in the file (the window's model and Claude path live there).
