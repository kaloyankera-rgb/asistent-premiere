"""Repeated takes and false starts (Phase 8 M3): finds the places where the speaker said the same thing again.

The result is a list of groups (the same passage said two or more times, or a start that was abandoned and said again)
with a recommended take and, for a plain repeat, the stretch to take out (`cut`); roughcut_job applies it
(docs/ROUGHCUT_PLAN.md §6, §7, §10). Works on the recognised words only: matching is by difflib on normalised words,
no extra download. The rule behind the recommendation is the editor's own: the last full, clean take wins; the score
that can overrule it is M4.
"""
from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher

SENTENCE_END = (".", "?", "!", "…")
SENTENCE_GAP = 0.5                  # a pause this long ends a sentence even without punctuation
COMMA_GAP = 0.25                    # a comma followed by a pause this long ends it too
WINDOW_S, WINDOW_N = 90.0, 12       # a sentence is compared with later ones inside this much time or this many sentences
MIN_WORDS = 3                       # shorter sentences ("Добре.", "Така.") repeat all the time: never matched
NEAR = 0.75                         # difflib ratio of the normalised words for a near repeat
LEN_RATIO = (0.6, 1.6)
FALSE_START_MAX = 6                 # an abandoned start is this short, or has no end mark
FALSE_START_S = 20.0                # ... and is said again within this many seconds (a start is abandoned at once)
CONTENT_MIN = 4                     # letters: shorter words are not content words for the safety rule
FINISH_GAP = 1.0                    # the next sentence follows within this many seconds: the take is not over yet
FINISH_MAX = 1
SKIP = 2                            # extra sentences one take may have in the middle that the others lack
LOST_WORDS = 2                      # a take that says more content words the winner lacks than this many (or this share of the
LOST_SHARE = 0.25                   # winner's content words, whichever is more) is not a plain repeat
LOOSE = 0.6                         # a sentence right before a take that matches the passage this loosely belongs to the take
BACK_GAP = 3.0                      # ... when it is said within this many seconds before it
WORD_LIKE = 0.75                    # two words this alike (same first letter) are the same word said a little differently
CHATTER_WORDS = 8                   # between two takes only short sentences (setup talk: „Добре, готови?“) ...
CHATTER_S = 25.0                    # ... and at most this much talk: then everything from the first take to the winner goes
RESTART_GAP = 0.25                  # a restart inside a sentence: the first copy ends with a pause or filler this long
RESTART_SPAN = 8                    # ... and the second copy starts within this many words

# words that change what a sentence means when only one take has them (0.10.6, BUG-012: „не е подходящ“ and „е подходящ“
# were a safe near repeat and one was cut). A near repeat that differs in any of these is only listed, never cut.
NEGATIONS = {"не", "ни", "нито", "без", "няма", "нямаше", "нямам", "нямаш", "нямат", "никак", "нищо", "никой", "никога", "никъде",
             "not", "no", "never"}
_NUM_WORDS = None


def _number_words() -> set:
    global _NUM_WORDS
    if _NUM_WORDS is None:
        from . import numbers as N
        words = set(N._UNITS + N._TEENS + N._TENS + N._HUNDREDS)
        for forms in N._FORMS.values():
            words.update(forms.values())
        words.update({"нула", "хиляда", "хиляди", "милион", "милиона", "милиард", "половин", "половина", "първи", "втори", "трети",
                      "едната", "двата", "двете", "трите", "петте"})
        _NUM_WORDS = {w for w in words if w}
    return _NUM_WORDS


def _meaning(take: dict) -> set:
    """The words of a take that carry meaning a near repeat must not lose: negations, numbers (digits or words) and names
    (a capital letter that does not start a sentence)."""
    out = set()
    nums = _number_words()
    for t in take["_tokens"]:
        if t in NEGATIONS or t in nums or _is_number(t):
            out.add(t)
    prev_end = True
    for w in take["text"].split():
        core = norm(w)
        if core and not prev_end and w.lstrip("\"„“'(")[:1].isupper():
            out.add(core)
        prev_end = w.strip().endswith(SENTENCE_END)
    return out


FILLERS = {"ъъ", "ъ", "ъм", "ми", "мм", "ммм", "ами", "ех", "аа", "ээ", "uh", "um", "hm", "хм", "така", "де"}
KIND_LABEL = {"exact": "repeated take", "near": "repeated take (nearly the same)", "false_start": "false start", "restart": "repeated start"}

_NON_WORD = re.compile(r"[^\w]+", re.UNICODE)


def norm(word: str) -> str:
    """One word as compared: lowercase, no punctuation (digits and letters stay)."""
    return _NON_WORD.sub("", (word or "").lower())


def sentences(words: list[dict]) -> list[dict]:
    """Words -> sentences: {i, a, b (word index range), start, end, tokens, text, ends (has an end mark)}."""
    out: list[dict] = []
    cur: list[int] = []

    def close():
        if not cur:
            return
        toks = [t for t in (norm(words[k]["word"]) for k in cur) if t]
        if toks:
            last = words[cur[-1]]["word"].strip()
            out.append({"i": len(out), "a": cur[0], "b": cur[-1], "start": words[cur[0]]["start"], "end": words[cur[-1]]["end"],
                        "tokens": toks, "text": " ".join(words[k]["word"].strip() for k in cur), "ends": last.endswith(SENTENCE_END)})
        cur.clear()

    for k, w in enumerate(words):
        cur.append(k)
        txt = w["word"].strip()
        gap = words[k + 1]["start"] - w["end"] if k + 1 < len(words) else 99.0
        if txt.endswith(SENTENCE_END) or gap > SENTENCE_GAP or (txt.endswith(",") and gap > COMMA_GAP):
            close()
    close()
    return out


def _content(tokens: list[str]) -> list[str]:
    return [t for t in tokens if t not in FILLERS]


def _is_number(t: str) -> bool:
    return t.isdigit()


def _word_like(x: str, y: str) -> bool:
    """The same word said a little differently („вижте“ / „виж“, „тези“ / „тази“); numbers only when equal."""
    if x == y:
        return True
    if x.isdigit() or y.isdigit() or len(x) < 3 or len(y) < 3 or x[0] != y[0]:
        return False
    return SequenceMatcher(None, x, y, autojunk=False).ratio() >= WORD_LIKE


def _loose(ta: list[str], tb: list[str]) -> float:
    """Ratio of two word lists like difflib's, with alike words counted as equal (longest common subsequence)."""
    if not ta or not tb:
        return 0.0
    prev = [0] * (len(tb) + 1)
    for x in ta:
        cur = [0]
        for k, y in enumerate(tb):
            cur.append(prev[k] + 1 if _word_like(x, y) else max(prev[k + 1], cur[k]))
        prev = cur
    return 2 * prev[-1] / (len(ta) + len(tb))


def _similar(a: dict, b: dict) -> tuple[str, float] | None:
    """How sentence `b` repeats earlier sentence `a`: ('exact' | 'near' | 'false_start', score) or None."""
    ta, tb = _content(a["tokens"]), _content(b["tokens"])
    if len(ta) < 2 or len(tb) < 2:
        return None
    if ta == tb and len(ta) >= MIN_WORDS:
        return "exact", 1.0
    # an abandoned start: short or unfinished, and the later sentence opens with the same words
    if (len(ta) <= FALSE_START_MAX or not a["ends"]) and len(tb) > len(ta) and b["start"] - a["end"] <= FALSE_START_S:
        k = 0
        while k < min(len(ta), len(tb)) and ta[k] == tb[k]:
            k += 1
        if k >= 3 and k >= len(ta) - 1:
            return "false_start", k / len(ta)
    # the later one breaks off: it is only the opening of the earlier one (an attempt abandoned after a good take)
    if not b["ends"] and len(tb) >= 3 and len(ta) > len(tb) and ta[:len(tb)] == tb and b["start"] - a["end"] <= FALSE_START_S:
        return "false_start", len(tb) / len(ta)
    if len(ta) >= MIN_WORDS and len(tb) >= MIN_WORDS and LEN_RATIO[0] <= len(tb) / len(ta) <= LEN_RATIO[1]:
        r = SequenceMatcher(None, ta, tb, autojunk=False).ratio()
        if r >= NEAR:
            return "near", r
    return None


def _groups_of_sentences(sent: list[dict]) -> dict:
    """Union-find over the matched sentence pairs -> {root: {"members": [i], "kind": kind}}."""
    parent = list(range(len(sent)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    kinds: dict = {}
    for i, a in enumerate(sent):
        for j in range(i + 1, min(len(sent), i + 1 + WINDOW_N)):
            b = sent[j]
            if b["start"] - a["end"] > WINDOW_S:
                break
            m = _similar(a, b)
            if m:
                parent[find(j)] = find(i)
                kinds[(i, j)] = m[0]
    groups: dict = {}
    for i in range(len(sent)):
        groups.setdefault(find(i), {"members": [], "kind": None})["members"].append(i)
    order = {"false_start": 0, "near": 1, "exact": 2}
    for (i, j), k in kinds.items():
        g = groups[find(i)]
        if g["kind"] is None or order[k] < order[g["kind"]]:
            g["kind"] = k                                 # a group is as sure as its weakest match
    return {r: g for r, g in groups.items() if len(g["members"]) > 1}


def _chains(sent: list[dict], groups: dict) -> list[dict]:
    """Groups whose members are followed by members of the same next group are one longer passage said several times.
    A take may have up to SKIP extra sentences in the middle that the other takes lack."""
    gid = {i: r for r, g in groups.items() for i in g["members"]}

    def after(i):
        for j in range(i + 1, min(len(sent), i + 2 + SKIP)):
            if j in gid:
                return j
        return None

    links = []
    for r, g in groups.items():
        pairs = [(i, after(i)) for i in g["members"]]
        c = Counter(gid[j] for i, j in pairs if j is not None and gid[j] != r)
        if c:
            h, n = c.most_common(1)[0]
            if n >= 2 and n >= 0.6 * len(g["members"]) and n >= 0.6 * len(groups[h]["members"]):
                gap = sum(sent[j]["start"] - sent[i]["end"] for i, j in pairs if j is not None and gid[j] == h) / n
                links.append((n, gap, r, h))
    # the last sentence of one take is followed by the first of the next one: that link closes a ring. It is the weakest
    # (fewer takes have it) or, as strong, the one with the longest pause (the break between two takes), so it goes last
    # and is dropped, and what is left is the passage in order
    nxt: dict = {}
    for n, _, r, h in sorted(links, key=lambda x: (-x[0], x[1], x[2])):
        at = h
        while at in nxt and at != r:
            at = nxt[at]
        if at != r and h not in nxt.values():
            nxt[r] = h
    heads = [r for r in groups if r not in set(nxt.values())]
    out = []
    used: set = set()
    for h in heads:
        chain = [h]
        while chain[-1] in nxt and nxt[chain[-1]] not in chain:
            chain.append(nxt[chain[-1]])
        used.update(chain)
        spans, taken = [], set()
        for t, r in enumerate(chain):
            for i in groups[r]["members"]:
                if i in taken:
                    continue
                span = [i]
                for r2 in chain[t + 1:]:
                    j = after(span[-1])
                    if j is None or gid[j] != r2:
                        break
                    span += list(range(span[-1] + 1, j + 1))
                taken.update(span)
                spans.append((sorted(span), t))
        out.append({"kind": min((groups[r]["kind"] for r in chain), key=lambda k: {"false_start": 0, "near": 1, "exact": 2}[k]),
                    "spans": spans, "refs": [groups[r]["members"] for r in chain]})
    for r, g in groups.items():
        if r not in used:
            out.append({"kind": g["kind"], "spans": [([i], 0) for i in g["members"]], "refs": [g["members"]]})
    return out


def _back(sent: list[dict], span: list[int], t0: int, refs: list[list[int]], taken: set) -> list[int]:
    """A take that begins in the middle of the passage (its opening was said in other words: „Вижте тези чини! Ако са под
    700 евро, ги взимаме.“ against „Виж тази чиния. Ако е под 700 евро, да я взимаме.“) gets those sentences back."""
    span = list(span)
    for u in range(t0 - 1, -1, -1):
        j = span[0] - 1
        if j < 0 or j in taken or sent[span[0]]["start"] - sent[j]["end"] > BACK_GAP:
            break
        tj = _content(sent[j]["tokens"])
        if not any(_loose(tj, _content(sent[m]["tokens"])) >= LOOSE for m in refs[u]):
            break
        span.insert(0, j)
    return span


def _finish(sent: list[dict], span: list[int], limit: int) -> list[int]:
    """A take that stops at a comma or a pause inside its last sentence is finished with the sentence right after it
    (when it follows within FINISH_GAP and is not already the next take)."""
    span = list(span)
    for _ in range(FINISH_MAX):
        last = span[-1]
        if sent[last]["ends"] or last + 1 >= limit or sent[last + 1]["start"] - sent[last]["end"] > FINISH_GAP:
            break
        span.append(last + 1)
    return span


def _recommend(takes: list[dict]) -> int:
    """The editor's rule: the last full take. Full = ends with an end mark and is not much shorter than the longest."""
    longest = max(t["n_words"] for t in takes)
    for k in range(len(takes) - 1, -1, -1):
        if takes[k]["ends"] and takes[k]["n_words"] >= 0.8 * longest:
            return k
    return len(takes) - 1


def find(words: list[dict]) -> list[dict]:
    """Repeated takes and false starts in the recognised words, in time order. Each group:
    {kind, kind_label, takes: [{start, end, text, n_words, ends}], recommended (index), safe (a plain repeat: the losing takes say
    nothing the winner does not), lost (the content words only a losing take has), cut: [(start, end)] seconds to take out
    for it (empty when it must be looked at), whole (the cut runs from the first take to the winner)}."""
    sent = sentences(words)
    out = []
    for ch in _chains(sent, _groups_of_sentences(sent)):
        spans = sorted(ch["spans"], key=lambda s: s[0][0])
        taken = {i for sp, _ in spans for i in sp}
        full = []
        for k, (span, t0) in enumerate(spans):
            span = _back(sent, span, t0, ch["refs"], taken - set(span)) if t0 else span
            span = _finish(sent, span, spans[k + 1][0][0] if k + 1 < len(spans) else len(sent))
            full.append(span)
        takes = []
        for span in full:
            ss = [sent[i] for i in span]
            takes.append({"start": ss[0]["start"], "end": ss[-1]["end"], "text": " ".join(s["text"] for s in ss),
                          "n_words": sum(len(s["tokens"]) for s in ss), "ends": ss[-1]["ends"],
                          "_tokens": [t for s in ss for t in _content(s["tokens"])], "_span": span})
        if len(takes) < 2 or any(takes[k]["start"] < takes[k - 1]["end"] for k in range(1, len(takes))):
            continue
        rec = _recommend(takes)
        said = takes[rec]["_tokens"]
        keep = {t for t in said if len(t) >= CONTENT_MIN or _is_number(t)}
        lost: list[str] = []
        for k, t in enumerate(takes):
            for x in t["_tokens"] if k != rec else []:
                if (len(x) >= CONTENT_MIN or _is_number(x)) and x not in lost and not any(_word_like(x, y) for y in said):
                    lost.append(x)
        safe = len(lost) <= max(LOST_WORDS, LOST_SHARE * len(keep)) and not any(_is_number(x) for x in lost)
        # meaning words that only some takes have (either way: the winner may ADD a „не“ the others lack)
        win_meaning = _meaning(takes[rec])
        for k, t in enumerate(takes):
            if k == rec:
                continue
            for x in sorted(win_meaning ^ _meaning(t)):
                if x not in lost:
                    lost.append(x)
                safe = False
        cut, whole = _cut_plan(sent, takes, rec) if safe and takes[rec]["ends"] else ([], False)
        for t in takes:
            t.pop("_tokens")
            t.pop("_span")
        out.append({"kind": ch["kind"], "kind_label": KIND_LABEL[ch["kind"]], "takes": takes, "recommended": rec, "safe": safe, "lost": lost,
                    "cut": cut, "whole": whole})
    out += restarts(words, out)
    out.sort(key=lambda g: g["takes"][0]["start"])
    return out


def _cut_plan(sent: list[dict], takes: list[dict], rec: int) -> tuple[list[tuple[float, float]], bool]:
    """What goes for a plain repeat. The takes before the winner: from the first of them up to the winner in one piece when
    only short setup talk is said between them (the editor's way: the scene starts again at the last good take), else each
    losing take alone. A take after the winner (one that broke off) goes alone."""
    cut: list[tuple[float, float]] = []
    whole = False
    if rec > 0:
        inside = {i for t in takes for i in t["_span"]}
        lo, hi = takes[0]["_span"][0], takes[rec]["_span"][0]
        talk = [sent[i] for i in range(lo, hi) if i not in inside]
        if all(len(x["tokens"]) <= CHATTER_WORDS for x in talk) and sum(x["end"] - x["start"] for x in talk) <= CHATTER_S:
            cut.append((takes[0]["start"], takes[rec]["start"]))
            whole = True
        else:
            cut += [(t["start"], t["end"]) for t in takes[:rec]]
    cut += [(t["start"], t["end"]) for t in takes[rec + 1:]]
    return cut, whole


def restarts(words: list[dict], found: list[dict]) -> list[dict]:
    """A start repeated inside one sentence („днес ще ви… днес ще ви покажа“): the same 2-4 words twice, close together,
    with a pause or a filler between. Only the first copy is the candidate cut."""
    toks = [norm(w["word"]) for w in words]
    seen = [(g["takes"][0]["start"], g["takes"][-1]["end"]) for g in found]
    out = []
    k = 0
    while k < len(words) - 3:
        done = False
        for n in (4, 3, 2):
            a = toks[k:k + n]
            if len(a) < n or not all(a) or all(t in FILLERS for t in a):
                continue
            for j in range(k + n, min(len(words) - n + 1, k + n + RESTART_SPAN)):
                if toks[j:j + n] != a:
                    continue
                between = words[k + n:j]
                if not all(norm(w["word"]) in FILLERS for w in between):
                    continue                                   # words in between: it is an ordinary repeat inside the talk
                gap = words[j]["start"] - words[k + n - 1]["end"]
                if not (gap >= RESTART_GAP or between):
                    continue
                first = (words[k]["start"], words[j - 1]["end"])
                second = (words[j]["start"], words[min(j + n, len(words)) - 1]["end"])
                if any(s <= first[0] < e or s < first[1] <= e for s, e in seen):
                    continue
                out.append({"kind": "restart", "kind_label": KIND_LABEL["restart"], "recommended": 1, "safe": True, "lost": [],
                            "cut": [(first[0], second[0])], "whole": False,
                            "takes": [{"start": first[0], "end": first[1], "text": " ".join(w["word"].strip() for w in words[k:j]), "n_words": j - k, "ends": False},
                                      {"start": second[0], "end": second[1], "text": " ".join(w["word"].strip() for w in words[j:j + n]), "n_words": n, "ends": False}]})
                k = j
                done = True
                break
            if done:
                break
        k += 1
    return out
