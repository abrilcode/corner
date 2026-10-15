#!/usr/bin/env python3
"""Corner's list, from the command line (used by the corner skill in Claude Code).

The Corner window watches the same file and updates by itself.

  corner.py list [--json] [--done]
  corner.py add "text" [--project P] [--priority P0|P1] [--link URL ...]
  corner.py add-json            < {"items":[{"project":"website","text":"...","priority":"P0","links":[]}]}
  corner.py done ID [ID ...]    corner.py reopen ID
  corner.py edit ID [--text T] [--project P] [--priority P0|P1|none]
  corner.py link ID URL         corner.py delete ID
  corner.py project add NAME [--project-id X] [--dashboard URL] [--keywords K]
  corner.py project edit ID [--name N] [--project-id X] [--dashboard URL] [--keywords K]
  corner.py path

P is a project id or name ("general" when left out). A project named with
--project that does not exist yet is created. Priorities are P0 or P1 only
(most items have none); "P0 text" at the start of a text sets it too.
"""

import argparse
import datetime as dt
import json
import os
import re
import secrets
import shutil
import sys
import unicodedata

FILE = os.environ.get("CORNER_DATA") or os.path.expanduser("~/.corner/corner.json")
URL_RE = re.compile(r"\bhttps?://[^\s<>\"')\]]+")
PRIO_RE = re.compile(r"^\s*\[?(p[01])\]?(?:\s*[:\-–]\s*|\s+)(.+)$", re.I)


def prio(v):
    v = s(v).upper()
    return v if v in ("P0", "P1") else ""


def split_priority(text):
    m = PRIO_RE.match(text)
    return (m.group(2).strip(), m.group(1).upper()) if m else (text, "")


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def s(v):
    return v.strip() if isinstance(v, str) else ""


def general():
    return {"id": "general", "name": "General", "projectId": "", "dashboard": "", "keywords": "anything not tied to a project"}


def norm_links(links):
    out, seen = [], set()
    for l in links or []:
        url = s(l if isinstance(l, str) else (l or {}).get("url"))
        if url and url not in seen:
            seen.add(url)
            out.append({"url": url, "label": s((l or {}).get("label")) if isinstance(l, dict) else ""})
    return out


def normalize(d):
    d = d if isinstance(d, dict) else {}
    projects = [
        {"id": s(p.get("id")), "name": s(p.get("name")), "projectId": s(p.get("projectId")),
         "dashboard": s(p.get("dashboard")), "keywords": s(p.get("keywords"))}
        for p in d.get("projects") or [] if isinstance(p, dict) and s(p.get("id")) and s(p.get("name"))
    ]
    if not any(p["id"] == "general" for p in projects):
        projects.insert(0, general())
    ids = {p["id"] for p in projects}
    items = []
    for i in d.get("items") or []:
        if not isinstance(i, dict) or not s(i.get("text")):
            continue
        done = bool(i.get("done"))
        items.append({
            "id": s(i.get("id")) or secrets.token_hex(4),
            "project": s(i.get("project")) if s(i.get("project")) in ids else "general",
            "text": s(i.get("text")), "priority": prio(i.get("priority")),
            "links": norm_links(i.get("links")), "done": done,
            "created": s(i.get("created")) or now(),
            "doneAt": (s(i.get("doneAt")) or now()) if done else None,
            "source": s(i.get("source")) or "app",
        })
    settings = d.get("settings") if isinstance(d.get("settings"), dict) else {}
    return {"version": 1, "projects": projects, "items": items, "settings": settings}


def read():
    try:
        with open(FILE, encoding="utf-8") as f:
            text = f.read()
    except FileNotFoundError:
        return normalize({})
    try:
        return normalize(json.loads(text))
    except json.JSONDecodeError as e:
        sys.exit(f"{FILE} is not valid JSON ({e}). The last good copy is {FILE}.bak; nothing was changed.")


def write(d):
    os.makedirs(os.path.dirname(FILE), exist_ok=True)
    if os.path.exists(FILE):
        shutil.copyfile(FILE, FILE + ".bak")
    tmp = f"{FILE}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, FILE)


def slug(name, taken):
    base = unicodedata.normalize("NFKD", name.lower())
    base = re.sub(r"[^\w\s-]", "", base).strip()
    base = re.sub(r"-+", "-", re.sub(r"[\s_]+", "-", base))[:40] or "project"
    out, n = base, 2
    while out in taken:
        out, n = f"{base}-{n}", n + 1
    return out


def find_project(d, ref):
    r = s(ref).lower()
    if not r:
        return None
    return next((p for p in d["projects"] if p["id"] == r), None) or next((p for p in d["projects"] if p["name"].lower() == r), None)


def add_project(d, name, project_id="", dashboard="", keywords=""):
    name = s(name)
    if not name:
        sys.exit("A project needs a name.")
    p = find_project(d, name)
    if p:
        return p
    p = {"id": slug(name, {x["id"] for x in d["projects"]}), "name": name, "projectId": s(project_id),
         "dashboard": s(dashboard), "keywords": s(keywords)}
    d["projects"].append(p)
    return p


def split_links(text):
    links = [u.rstrip(".,;:") for u in URL_RE.findall(text)]
    rest = URL_RE.sub(lambda m: re.search(r"[.,;:]*$", m.group(0)).group(0), text)
    rest = re.sub(r"\s+([.,;:])", r"\1", re.sub(r"\s{2,}", " ", rest))
    rest = re.sub(r"[\s(:–-]+$", "", rest).strip()
    return (rest or text.strip()), links


def add_items(d, items, source="claude-code"):
    added = []
    for raw in items:
        p = find_project(d, raw.get("project"))
        if not p and s(raw.get("newProject")):
            p = add_project(d, raw["newProject"])
        if not p and s(raw.get("project")) and s(raw.get("project")) != "new":
            p = add_project(d, raw["project"])
        p = p or find_project(d, "general")
        text, pr = split_priority(s(raw.get("text")))
        text, links = split_links(text)
        if not text:
            continue
        item = {"id": secrets.token_hex(4), "project": p["id"], "text": text,
                "priority": prio(raw.get("priority")) or pr,
                "links": norm_links(list(raw.get("links") or []) + links), "done": False,
                "created": now(), "doneAt": None, "source": source}
        d["items"].append(item)
        added.append(item)
    return added


def item(d, ref):
    it = next((i for i in d["items"] if i["id"] == ref), None)
    if not it:
        sys.exit(f"No item with id {ref}. Run `corner.py list` for the ids.")
    return it


def show(d, done=False):
    by = {p["id"]: [] for p in d["projects"]}
    for i in d["items"]:
        if i["done"] == done and i["project"] in by:
            by[i["project"]].append(i)
    rank = {"P0": 0, "P1": 1}
    for lst in by.values():
        lst.sort(key=lambda i: rank.get(i["priority"], 2))
    for p in d["projects"]:
        head = p["name"] + f"  [{p['id']}]"
        if p["projectId"]:
            head += f"  project ID {p['projectId']}"
        if p["dashboard"]:
            head += f"  {p['dashboard']}"
        print(head)
        for i in by[p["id"]]:
            links = "  " + " ".join(l["url"] for l in i["links"]) if i["links"] else ""
            tag = f"[{i['priority']}] " if i["priority"] else ""
            print(f"  {'x' if i['done'] else '-'} {tag}{i['text']}  ({i['id']}){links}")
        if not by[p["id"]]:
            print("  (nothing)" if not done else "")
    print(f"\nFile: {FILE}")


def main():
    ap = argparse.ArgumentParser(description="Corner's list")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("list"); a.add_argument("--json", action="store_true"); a.add_argument("--done", action="store_true")
    a = sub.add_parser("add"); a.add_argument("text"); a.add_argument("--project", default="general"); a.add_argument("--priority", default="")
    a.add_argument("--link", action="append", default=[])
    sub.add_parser("add-json")
    a = sub.add_parser("done"); a.add_argument("ids", nargs="+")
    a = sub.add_parser("reopen"); a.add_argument("ids", nargs="+")
    a = sub.add_parser("edit"); a.add_argument("id"); a.add_argument("--text"); a.add_argument("--project"); a.add_argument("--priority")
    a = sub.add_parser("link"); a.add_argument("id"); a.add_argument("url")
    a = sub.add_parser("delete"); a.add_argument("id")
    a = sub.add_parser("project"); psub = a.add_subparsers(dest="pcmd", required=True)
    for name in ("add", "edit"):
        b = psub.add_parser(name)
        b.add_argument("ref", help="name (add) or id (edit)")
        b.add_argument("--name"); b.add_argument("--project-id"); b.add_argument("--dashboard"); b.add_argument("--keywords")
    sub.add_parser("path")
    args = ap.parse_args()

    if args.cmd == "path":
        return print(FILE)
    d = read()
    if args.cmd == "list":
        if args.json:
            return print(json.dumps({"file": FILE, "projects": d["projects"],
                                     "items": [i for i in d["items"] if i["done"] == args.done]}, indent=2, ensure_ascii=False))
        return show(d, args.done)

    if args.cmd == "add":
        out = add_items(d, [{"project": args.project, "text": args.text, "links": args.link, "priority": args.priority}])
    elif args.cmd == "add-json":
        payload = json.load(sys.stdin)
        out = add_items(d, payload.get("items", payload) if isinstance(payload, dict) else payload)
    elif args.cmd in ("done", "reopen"):
        out = []
        for ref in args.ids:
            it = item(d, ref)
            it["done"] = args.cmd == "done"
            it["doneAt"] = now() if it["done"] else None
            out.append(it)
    elif args.cmd == "edit":
        it = item(d, args.id)
        if args.text:
            text, pr = split_priority(args.text)
            it["text"], links = split_links(text)
            it["links"] = norm_links(it["links"] + links)
            if pr:
                it["priority"] = pr
        if args.priority is not None:
            it["priority"] = prio(args.priority)
        if args.project:
            p = find_project(d, args.project) or add_project(d, args.project)
            it["project"] = p["id"]
        out = [it]
    elif args.cmd == "link":
        it = item(d, args.id)
        it["links"] = norm_links(it["links"] + [args.url])
        out = [it]
    elif args.cmd == "delete":
        it = item(d, args.id)
        d["items"].remove(it)
        out = [it]
    elif args.cmd == "project":
        if args.pcmd == "add":
            p = add_project(d, args.name or args.ref, args.project_id or "", args.dashboard or "", args.keywords or "")
        else:
            p = find_project(d, args.ref)
            if not p:
                sys.exit(f"No project {args.ref}.")
            for key, val in (("name", args.name), ("projectId", args.project_id), ("dashboard", args.dashboard), ("keywords", args.keywords)):
                if val is not None:
                    p[key] = val.strip()
        out = [p]
    write(d)
    names = {p["id"]: p["name"] for p in d["projects"]}
    for o in out:
        if "text" in o:
            tag = f"{o['priority']} " if o.get("priority") else ""
            print(f"{args.cmd}: [{names.get(o['project'], o['project'])}] {tag}{o['text']}  ({o['id']})")
        else:
            print(f"project: {o['name']}  [{o['id']}]")


if __name__ == "__main__":
    main()
