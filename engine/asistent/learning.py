"""What the editors fixed in the subtitles, remembered and shared through the office, so the next videos come out right.

The user's decisions (2026-11-04, the Smart Subtitle Correction plan): learning happens in the background with nothing
to press; every editor's fixes help everyone (an office folder, never a cloud service); one editor's single fix must
not reach everyone unchecked.

Where: each client folder on the office server may hold a folder whose name ends in „Subtitle Learning“
(„ReShape/ReShape Subtitle Learning“). It is found by walking up from the project file, so it names the client too and
no office address is written in the code. Every computer appends to its own file there (`events/<computer>.jsonl`:
two editors never write the same file) and reads all of them. A project outside such a client folder learns on this
computer only (`<app>/learning/local`). A write that fails (the server dropped) waits in `<app>/learning/outbox.jsonl`.

What is learned (one event per project, so rebuilding a project does not count again):
- `fix`: a correction line („heard => said“) that matched in the run, with the words around it;
- `revert`: a correction that undoes a learned fix (the editor typed the original back): the fix starts over;
- `term`: a name or term line of the corrections box; `english`: an English line the editor typed for a Bulgarian line;
  `english_word`: the words the editor changed in an English line („lipidemia“ -> „lipedema“, 0.9.98), used for the whole
  client from the first fix (typing the old word back takes it out);
- `used`: a learned fix was used in a project (with its sound score): with the reverts, how often learned fixes are right;
- `speaker`: who speaks on a microphone track (the client's default for its next projects);
- `remove` / `restore`: the Learned list in the Captions tab.

When a learned fix applies (`Rule.active`):
- a name or term (its new words are not dictionary words: „Решейп => ReShape“): for the whole client from the first fix;
- other words: on the computer that made the fix from its next project, for everyone after fixes in two projects;
- for other clients: after fixes in three projects by two computers;
- a single dictionary word is replaced only between the words it was fixed between („като по => като при“ is its own
  context); and the sound is checked before any learned fix is used (subtitle_job.py, audiocheck.py).
"""
from __future__ import annotations

import glob
import hashlib
import json
import logging
import os
import re
import socket
import subprocess
import sys
import threading
import time
import uuid
from urllib.parse import unquote

from . import config, lexicon
from .consensus import norm

log = logging.getLogger("asistent")
FORMAT = 1
FOLDER_SUFFIX = "subtitle learning"
WALK_UP = 8
SHARED_PROJECTS = 2          # fixes in this many projects make a word fix everyone's
GENERAL_PROJECTS = 3         # ... and in this many, by GENERAL_COMPUTERS computers, every client's
GENERAL_COMPUTERS = 2
MAX_TERMS = 30               # learned names in Whisper's prompt (it has room for about 220 tokens)
FIND_TTL = 600.0
_lock = threading.Lock()
_found: dict = {}
_files: dict = {}
_threads: list = []


def learning_dir() -> str:
    d = os.path.join(config.app_dir(), "learning")
    os.makedirs(d, exist_ok=True)
    return d


def computer() -> dict:
    """This computer's id (made once) and name, written with every event."""
    path = os.path.join(learning_dir(), "computer.json")
    try:
        with open(path, encoding="utf-8") as f:
            me = json.load(f)
        if isinstance(me, dict) and re.fullmatch(r"[0-9a-f]{12}", str(me.get("id", ""))):
            return me
    except (OSError, ValueError):
        pass
    me = {"id": uuid.uuid4().hex[:12], "name": socket.gethostname()}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(me, f)
    return me


def phrase_key(text: str) -> str:
    return " ".join(t for t in (norm(x) for x in str(text).split()) if t)


def rule_key(heard: str, said: str) -> str:
    return phrase_key(heard) + "=>" + " ".join(str(said).split()).lower()


def project_id(project: str) -> str:
    return hashlib.sha1(os.path.normcase(os.path.abspath(project or "")).encode("utf-8")).hexdigest()[:12]


# ---------------------------------------------------------------- where the client's learning folder is

def _mounts() -> list[tuple[str, str, str]]:
    """Mac network mounts -> [(server, path on the server, mount point)]. Finder mounts a deep folder of a share as its
    own volume („/Volumes/Видео 1 - …“ is Production/ReShape/…/Видео 1), which hides the client folder above it."""
    if sys.platform != "darwin":
        return []
    try:
        text = subprocess.run(["/sbin/mount"], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    out = []
    for line in text.splitlines():
        m = re.match(r"^//(?:[^@/]+@)?([^/]+)/(.*?) on (/Volumes/.+?) \(", line)
        if m:
            out.append((m.group(1).lower(), unquote(m.group(2)).strip("/"), m.group(3)))
    return out


def _alternatives(path: str) -> list[str]:
    """The project path, and the same file seen through a mount of a higher folder of the same share."""
    out = [path]
    mounts = _mounts()
    for host, remote, point in mounts:
        if path == point or path.startswith(point + "/"):
            full = (remote + path[len(point):]).strip("/")
            for h2, r2, p2 in mounts:
                if h2 == host and p2 != point and (full == r2 or full.startswith(r2 + "/")):
                    out.append(p2 + full[len(r2):])
    return out


def find_folder(project: str) -> tuple[str, str] | None:
    """Project file -> (client, its learning folder), or None outside a client folder that has one."""
    now = time.time()
    hit = _found.get(project)
    if hit and now - hit[0] < FIND_TTL:
        return hit[1]
    found = None
    for p in _alternatives(os.path.abspath(project)) if project else []:
        d = os.path.dirname(p)
        for _ in range(WALK_UP):
            try:
                names = os.listdir(d)
            except OSError:
                names = []
            for n in sorted(names):
                if n.lower().endswith(FOLDER_SUFFIX) and os.path.isdir(os.path.join(d, n)):
                    found = (os.path.basename(d), os.path.join(d, n))
                    break
            if found or os.path.dirname(d) == d:
                break
            d = os.path.dirname(d)
        if found:
            break
    _found[project] = (now, found)
    return found


def _siblings(folder: str) -> list[str]:
    """The learning folders of the other clients next to this one (Production/<client>/<client> Subtitle Learning)."""
    client_dir = os.path.dirname(folder)
    out = []
    try:
        for c in sorted(os.listdir(os.path.dirname(client_dir))):
            cd = os.path.join(os.path.dirname(client_dir), c)
            if cd == client_dir or not os.path.isdir(cd):
                continue
            out += [os.path.join(cd, n) for n in os.listdir(cd) if n.lower().endswith(FOLDER_SUFFIX) and os.path.isdir(os.path.join(cd, n))]
    except OSError:
        pass
    return out


# ---------------------------------------------------------------- events on disk

def read_events(folder: str) -> list[dict]:
    """Every computer's events in a learning folder (files re-read only when they changed)."""
    out = []
    for path in sorted(glob.glob(os.path.join(folder, "events", "*.jsonl"))):
        try:
            st = os.stat(path)
        except OSError:
            continue
        sig = (st.st_mtime, st.st_size)
        cached = _files.get(path)
        if not cached or cached[0] != sig:
            evs = []
            try:
                with open(path, encoding="utf-8") as f:
                    for line in f:
                        try:
                            ev = json.loads(line)
                        except ValueError:
                            continue                       # a line cut by a dropped connection
                        if isinstance(ev, dict) and ev.get("v") == FORMAT and isinstance(ev.get("kind"), str):
                            evs.append(ev)
            except OSError:
                continue
            cached = (sig, evs)
            _files[path] = cached
        out += cached[1]
    return out


def _append(folder: str, events: list[dict]) -> bool:
    if not events:
        return True
    path = os.path.join(folder, "events", computer()["id"] + ".jsonl")
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            for ev in events:
                f.write(json.dumps(ev, ensure_ascii=False) + "\n")
        return True
    except OSError as e:
        log.warning("learning: could not write to %s (%s), kept for later", folder, e)
        return False


def _outbox() -> str:
    return os.path.join(learning_dir(), "outbox.jsonl")


def flush_outbox() -> None:
    """Send what waited for the server; what still cannot be written stays."""
    path = _outbox()
    if not os.path.isfile(path):
        return
    with _lock:
        waiting: dict = {}
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    x = json.loads(line)
                    waiting.setdefault(x["folder"], []).append(x["event"])
                except (ValueError, KeyError, TypeError):
                    continue
        left = [{"folder": d, "event": e} for d, evs in waiting.items() if not (os.path.isdir(d) and _append(d, evs)) for e in evs]
        if left:
            with open(path + ".tmp", "w", encoding="utf-8") as f:
                f.writelines(json.dumps(x, ensure_ascii=False) + "\n" for x in left)
            os.replace(path + ".tmp", path)
        else:
            os.remove(path)


def _write(folder: str, events: list[dict]) -> None:
    with _lock:
        if _append(folder, events):
            return
        with open(_outbox(), "a", encoding="utf-8") as f:
            for ev in events:
                f.write(json.dumps({"folder": folder, "event": ev}, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- rules

class Rule:
    def __init__(self, heard: str, said: str):
        self.heard, self.said, self.key = heard, said, rule_key(heard, said)
        self.tokens = phrase_key(heard).split()
        self.projects: set = set()
        self.computers: set = set()
        self.left: set = set()
        self.right: set = set()
        self.term = False
        self.removed = False
        self.reverted = 0
        self.used: set = set()
        self.last = 0.0
        self.seen = 0.0                                   # time of the newest event about this fix
        self.examples: list = []

    @property
    def free(self) -> bool:
        """Can it replace without the words around it: more than one word, or a word that is not a dictionary word."""
        return len(self.tokens) > 1 or any(lexicon.known(t) is False for t in self.tokens)

    def active(self, me: str) -> bool:
        if self.removed or not self.projects:
            return False
        return self.term or me in self.computers or len(self.projects) >= SHARED_PROJECTS

    def general(self) -> bool:
        return not self.removed and len(self.projects) >= GENERAL_PROJECTS and len(self.computers) >= GENERAL_COMPUTERS


def is_term(said: str) -> bool:
    """New words that are names or terms: Latin letters, digits, or words the dictionary does not know."""
    for t in str(said).split():
        core = re.sub(r"^\W+|\W+$", "", t, flags=re.UNICODE)
        if core and (re.search(r"[A-Za-z0-9]", core) or lexicon.known(core) is False):
            return True
    return False


def build(events: list[dict]) -> tuple[dict, dict, dict, dict, dict]:
    """Events -> ({rule key: Rule}, {term: last time}, {Bulgarian line key: English}, {track: speaker},
    {English words as translated (lower case): as the editors write them})."""
    rules: dict = {}
    terms: dict = {}
    english: dict = {}
    speakers: dict = {}
    en_words: dict = {}
    for ev in sorted(events, key=lambda e: e.get("t", 0)):
        kind = ev["kind"]
        if kind in ("fix", "revert", "remove", "restore", "used"):
            heard, said = str(ev.get("heard", "")), str(ev.get("said", ""))
            if not phrase_key(heard) or not said.strip():
                continue
            r = rules.get(rule_key(heard, said))
            if r is None:
                r = rules[rule_key(heard, said)] = Rule(heard, said)
            r.seen = max(r.seen, float(ev.get("t", 0) or 0))
            if kind == "fix":
                r.projects.add(ev.get("project"))
                r.computers.add(ev.get("computer"))
                r.left.update(x for x in [ev.get("left")] if x)
                r.right.update(x for x in [ev.get("right")] if x)
                r.term = r.term or bool(ev.get("term"))
                r.last = ev.get("t", 0)
                r.examples = (r.examples + [ev.get("example")])[-3:] if ev.get("example") else r.examples
            elif kind == "used":
                r.used.add(ev.get("project"))
            elif kind == "revert":
                r.projects.clear()
                r.computers.clear()
                r.reverted += 1
            else:
                r.removed = kind == "remove"
        elif kind == "term" and str(ev.get("said", "")).strip():
            terms[str(ev["said"]).strip()] = ev.get("t", 0)
        elif kind == "english" and isinstance(ev.get("line"), str) and isinstance(ev.get("en"), str):
            english[ev["line"]] = ev["en"]
        elif kind == "speaker" and isinstance(ev.get("speakers"), dict):
            speakers = {str(k): v for k, v in ev["speakers"].items() if v in ("m", "f", "")}
        elif kind == "english_word" and str(ev.get("heard", "")).strip() and str(ev.get("said", "")).strip():
            heard, said = " ".join(str(ev["heard"]).lower().split()), " ".join(str(ev["said"]).split())
            if en_words.get(said.lower(), "").lower() == heard:
                del en_words[said.lower()]                    # the old word typed back: the fix is taken out, not reversed
            else:
                en_words[heard] = said
    return rules, terms, english, speakers, en_words


class Plan:
    """What one subtitles run uses: the active learned fixes, learned names for the prompt, learned English lines."""

    def __init__(self, project: str, client: str | None, folder: str, rules: list, terms: list, english: dict, known: dict,
                 speakers: dict | None = None, english_words: dict | None = None):
        self.project, self.client, self.folder = project, client, folder
        self.rules, self.terms, self.english, self.known = rules, terms, english, known
        self.speakers = speakers or {}
        self.english_words = english_words or {}
        self.pairs = [(r.heard, r.said) for r in self.rules]

    def context_ok(self, words: list[dict], i: int, n: int, k: int) -> bool:
        r = self.rules[k]
        if r.free:
            return True
        left = norm(words[i - 1]["word"]) if i > 0 else ""
        right = norm(words[i + n]["word"]) if i + n < len(words) else ""
        return (left and left in r.left) or (right and right in r.right)


def _events_for(folder: str) -> list[dict]:
    flush_outbox()
    return read_events(folder)


def plan_for(project: str, editor_pairs=()) -> Plan:
    """The learned fixes for a run of this project. A learned fix the editor's own lines undo („said => heard“) is left
    out (that line is recorded as a revert after the run)."""
    found = find_folder(project)
    client, folder = found if found else (None, os.path.join(learning_dir(), "local"))
    me = computer()["id"]
    rules, terms, english, speakers, en_words = build(_events_for(folder))
    general: dict = {}
    if found:
        for other in _siblings(folder):
            for key, r in build(read_events(other))[0].items():
                g = general.get(key)
                if g is None:
                    g = general[key] = Rule(r.heard, r.said)
                g.projects |= {(other, p) for p in r.projects}
                g.computers |= r.computers
                g.left |= r.left
                g.right |= r.right
                g.removed = g.removed or r.removed
    mine = {rule_key(h, s) for h, s in editor_pairs}
    undone = {rule_key(s, h) for h, s in editor_pairs}
    use = [r for k, r in rules.items() if r.active(me) and k not in mine and k not in undone]
    use += [g for k, g in general.items() if k not in rules and k not in mine and k not in undone and g.general()]
    names = [t for t, _ in sorted(terms.items(), key=lambda x: -x[1])]
    names += [r.said for r in sorted(rules.values(), key=lambda r: -r.last) if r.term and r.active(me)]
    return Plan(project, client, folder, use, names[:MAX_TERMS], english, rules, speakers, en_words)


def record(plan: Plan, contexts: list[dict], terms=(), english=None, background: bool = True, used=(), english_words=None) -> None:
    """After a run: the editor's correction lines that matched (`contexts`: [{"heard", "said", "left", "right",
    "example"}]), the name lines and the typed English lines become events of this project (once per project)."""
    me = computer()
    pid = project_id(plan.project)
    have = set()
    events = []

    def add(kind: str, key: str, **data):
        eid = hashlib.sha1(f"{me['id']}|{pid}|{kind}|{key}".encode("utf-8")).hexdigest()[:16]
        if eid not in have:
            have.add(eid)
            events.append({"v": FORMAT, "id": eid, "t": round(time.time(), 3), "computer": me["id"], "name": me["name"],
                           "project": pid, "client": plan.client or "", "kind": kind, **data})
    for c in contexts:
        undone = plan.known.get(rule_key(c["said"], c["heard"]))
        if undone is not None:                                 # the original typed back: never learned the other way
            add("revert", undone.key, heard=undone.heard, said=undone.said)
        else:
            add("fix", rule_key(c["heard"], c["said"]) + f"|{c.get('left', '')}|{c.get('right', '')}", heard=c["heard"],
                said=c["said"], left=c.get("left", ""), right=c.get("right", ""), term=is_term(c["said"]),
                example=c.get("example", ""))
    for t in terms:
        add("term", t.lower(), said=t)
    for u in used:
        r = plan.known.get(u.get("key"))
        if r is not None:
            add("used", r.key, heard=r.heard, said=r.said, margin=u.get("margin"))
    for line, en in (english or {}).items():
        add("english", line + "=>" + en, line=line, en=en)
    for heard, said in (english_words or {}).items():
        add("english_word", heard.lower() + "=>" + said, heard=heard, said=said)

    def work():
        try:
            seen = {e.get("id") for e in read_events(plan.folder)}
            new = [e for e in events if e["id"] not in seen]
            if new:
                _write(plan.folder, new)
                log.info("learning: %d new events for %s", len(new), plan.client or "this computer")
        except Exception as e:                                 # noqa: BLE001 - learning never breaks the subtitles
            log.warning("learning: record failed: %s", e)
    if background:
        t = threading.Thread(target=work, daemon=True)
        _threads.append(t)
        t.start()
    else:
        work()


def _client(project: str) -> tuple[str | None, str]:
    found = find_folder(project)
    return found if found else (None, os.path.join(learning_dir(), "local"))


def listing(project: str) -> dict:
    """The Learned list of the Captions tab: the client's learned fixes, newest first, with how far each has come."""
    client, folder = _client(project)
    me = computer()["id"]
    rules = build(_events_for(folder))[0]
    out = []
    for r in sorted(rules.values(), key=lambda r: -r.last):
        if not r.projects and not r.removed and not r.reverted:
            continue
        out.append({"key": r.key, "heard": r.heard, "said": r.said, "projects": len(r.projects), "computers": len(r.computers),
                    "used": len(r.used), "reverted": r.reverted, "removed": r.removed, "active": r.active(me),
                    "examples": r.examples})
    return {"client": client, "shared": client is not None, "rules": out}


def set_removed(project: str, key: str, removed: bool) -> dict:
    """Remove a learned fix for everyone (or bring it back): one event, written now."""
    client, folder = _client(project)
    rules = build(_events_for(folder))[0]
    r = rules.get(key)
    if r is None:
        raise ValueError("That learned fix was not found.")
    me = computer()
    at = max(round(time.time(), 3), round(r.seen + 0.001, 3))   # after everything this editor saw, whatever the clocks say
    ev = {"v": FORMAT, "id": uuid.uuid4().hex[:16], "t": at, "computer": me["id"], "name": me["name"],
          "project": project_id(project), "client": client or "", "kind": "remove" if removed else "restore",
          "heard": r.heard, "said": r.said}
    _write(folder, [ev])
    log.info("learning: %s %s => %s for %s", ev["kind"], r.heard, r.said, client or "this computer")
    return listing(project)


def record_speakers(project: str, speakers: dict) -> None:
    """Who speaks on which track: the client's default for its next projects."""
    client, folder = _client(project)
    me = computer()
    _write(folder, [{"v": FORMAT, "id": uuid.uuid4().hex[:16], "t": round(time.time(), 3), "computer": me["id"],
                     "name": me["name"], "project": project_id(project), "client": client or "", "kind": "speaker",
                     "speakers": speakers}])


def wait(timeout: float = 10.0) -> None:
    """Let background writes finish (tests, shutdown)."""
    while _threads:
        _threads.pop().join(timeout)


def reset() -> None:
    _found.clear()
    _files.clear()
