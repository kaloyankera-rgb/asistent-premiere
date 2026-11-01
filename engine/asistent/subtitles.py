"""Subtitle text core: words with times -> caption lines per preset, frame-snapped, and the SRT writer.

Pure Python, no Premiere and no ASR here. Line breaking is copied from tools/autoedit/export.py (`caption_lines`):
numbers stay with their word or unit, function words never end a line, a pause ends a caption, spelling goes
through bgtext. Input times are sequence seconds, output times are whole frames of the sequence.
"""
import math
import re

from . import bgtext

PUNCT_END = re.compile(r"[.,?!…]$")
# A pause between two words longer than this ends the caption (seconds).
PAUSE_SPLIT = 0.35
# The caption stays on screen a little after the last word is said (seconds), as in autoedit.
TAIL_HOLD = 0.2
# Whisper word probability below this is reported to the review list; the SRT text itself is never marked.
LOW_P = 0.5

NUMBER_WORDS = {"едно", "един", "една", "две", "два", "три", "четири", "пет", "шест", "седем", "осем", "девет", "десет",
                "сто", "хиляда", "хиляди"}
# A line must not end in one of these: they belong to the word that follows. Words of one or two letters
# (в, с, и, а, е, да, не...) are handled by length in `_attach_function_words`.
FUNCTION_WORDS = {"във", "със", "или", "към", "при", "над", "под", "пред", "след", "като", "ако", "но", "че", "за", "на",
                  "от", "до", "по", "през", "без", "между", "около", "върху", "чрез", "срещу", "зад", "освен", "щом",
                  "докато", "защото", "когато", "ще"}
UNITS = {"евро", "€", "лева", "лв", "nm", "процента", "%", "кг", "km", "км", "hz", "херца", "секунди", "минути",
         "монитора", "градуса", "метра", "мм", "см", "ват", "w", "часа", "години", "дни", "долара", "$", "kg", "mm", "cm"}

# short: for 9:16, one line of at most 2 words; max_chars is the nominal size (what fits at the usual font size),
# soft_chars is the real limit (a longer pair is still allowed, a third word never is).
# standard: for 16:9, up to 2 lines of 42 characters.
PRESETS = {
    "short": {"max_words": 2, "max_chars": 11, "soft_chars": 16, "lines": 1, "line_chars": 16,
              "min_s": 0.5, "max_s": 2.5},
    "standard": {"max_words": None, "max_chars": 42, "soft_chars": 42, "lines": 2, "line_chars": 42,
                 "min_s": 1.0, "max_s": 6.0},
}

# NTSC rates arrive as 23.976 / 29.97 / 59.94; the sequence really runs at N*1000/1001.
_NTSC = (24000 / 1001.0, 30000 / 1001.0, 60000 / 1001.0, 120000 / 1001.0)


def preset_for(width, height):
    """9:16 and square sequences get "short", landscape gets "standard"; an unknown size gets "short"."""
    try:
        w, h = float(width), float(height)
    except (TypeError, ValueError):
        return "short"
    if w <= 0 or h <= 0:
        return "short"
    return "standard" if w > h else "short"


def exact_fps(fps):
    """The real frame rate for a rounded NTSC value; any other rate is returned as is."""
    fps = float(fps)
    for r in _NTSC:
        if abs(fps - r) < 0.01:
            return r
    return fps


def initial_prompt(terms):
    """Names and terms the user listed -> the Whisper prompt string ("A, B, C."). Empty list -> empty string."""
    if isinstance(terms, str):
        terms = [terms]
    seen, out = set(), []
    for t in terms or []:
        t = str(t).strip().rstrip(",;").strip()
        if t and t.lower() not in seen:
            seen.add(t.lower())
            out.append(t)
    return ", ".join(out) + "." if out else ""


def _clean_words(words):
    """Whisper words -> plain dicts: stripped text, end >= start, p defaults to 1.0, in time order."""
    out = []
    for w in words or []:
        text = str(w.get("word", "")).strip()
        if not text:
            continue
        start = float(w["start"])
        end = max(float(w.get("end", start)), start)
        p = w.get("p")
        out.append({"word": text, "start": start, "end": end, "p": 1.0 if p is None else float(p)})
    out.sort(key=lambda w: w["start"])
    return out


def _glued(w, nxt):
    # A number and the word next to it are read together: "Формула 1", "за 8 евро", "едно евро", "25 Nm".
    if PUNCT_END.search(w["word"]):
        return False
    digit = lambda t: bool(re.search(r"\d", t))
    num = lambda t: digit(t) or t.lower().strip(".,?!") in NUMBER_WORDS
    # A digit goes with the word before it ("Формула 1", "за 8"), any number with the unit after it.
    return digit(nxt["word"]) or (num(w["word"]) and nxt["word"].lower().strip(".,?!") in UNITS)


def _units(words):
    """Words -> units that must stay on one line ("за 8 евро", "Формула 1")."""
    units = []
    for i, w in enumerate(words):
        if units and _glued(words[i - 1], w):
            units[-1].append(w)
        else:
            units.append([w])
    return units


def _attach_function_words(units):
    """A short or function word goes to the next unit, so it never ends a line. Back to front, so that
    chains ("или за състезателни") are caught too."""
    merged = []
    for u in reversed(units):
        t = u[0]["word"]
        short = len(re.sub(r"[.,…]+$", "", t)) <= 2 or t.lower() in FUNCTION_WORDS
        if merged and len(u) == 1 and short and not PUNCT_END.search(t):
            merged[0] = u + merged[0]
        else:
            merged.insert(0, u)
    return merged


def _text_len(words):
    return len(" ".join(w["word"] for w in words))


def _lines(units, cfg):
    """The units of one caption -> lines (lists of words). Two lines are split where they come out most even."""
    flat = [w for u in units for w in u]
    if cfg["lines"] == 1 or len(units) == 1 or _text_len(flat) <= cfg["line_chars"]:
        return [flat]
    best = None
    for k in range(1, len(units)):
        a = [w for u in units[:k] for w in u]
        b = [w for u in units[k:] for w in u]
        la, lb = _text_len(a), _text_len(b)
        over = max(0, la - cfg["line_chars"]) + max(0, lb - cfg["line_chars"])
        score = (over, abs(la - lb))
        if best is None or score < best[0]:
            best = (score, [a, b])
    return best[1]


def _fits(units, cfg):
    flat = [w for u in units for w in u]
    if cfg["max_words"] is not None and len(flat) > cfg["max_words"]:
        return False
    # A caption longer on screen than the maximum would be cut off in the middle of speech.
    if flat[-1]["end"] - flat[0]["start"] > cfg["max_s"]:
        return False
    return all(_text_len(line) <= cfg["line_chars"] for line in _lines(units, cfg))


def _group(words, cfg):
    units = _attach_function_words(_units(words))
    groups, cur = [], []
    for k, u in enumerate(units):
        # A unit longer than the limit (a long number phrase) still goes out alone rather than being split.
        if cur and not _fits(cur + [u], cfg):
            groups.append(cur)
            cur = []
        cur = cur + [u]
        nxt = units[k + 1][0] if k + 1 < len(units) else None
        full = cfg["max_words"] is not None and sum(len(x) for x in cur) >= cfg["max_words"]
        if nxt is None or PUNCT_END.search(u[-1]["word"]) or nxt["start"] - u[-1]["end"] > PAUSE_SPLIT or full:
            groups.append(cur)
            cur = []
    return groups


def build_captions(words, preset="short", fps=25.0):
    """Words (sequence seconds, `p` optional) -> captions {"start", "end", "text", "words", "flags"}.

    Spelling is fixed, lines follow the preset, every start/end is a whole frame at `fps`, the preset's
    min/max duration holds without overlapping the next caption, and no caption has zero length.
    A word with p < 0.5 adds {"word", "p", "at"} to `flags`; the text itself stays clean.
    """
    cfg = PRESETS[preset] if isinstance(preset, str) else preset
    fps = exact_fps(fps)
    words = _clean_words(words)
    if not words:
        return []
    # Spelling applies to the shown text only; the times stay as spoken.
    fixed = bgtext.fix_prepositions([w["word"] for w in words])
    words = [dict(w, word=t) for w, t in zip(words, fixed)]
    groups = _group(words, cfg)

    frame = lambda t: int(math.floor(t * fps + 0.5))
    min_f = max(1, int(math.ceil(cfg["min_s"] * fps - 1e-9)))
    max_f = max(min_f, int(math.floor(cfg["max_s"] * fps + 1e-9)))
    first = [frame(g[0][0]["start"]) for g in groups]
    # Starts strictly increase: two captions can never start on the same frame.
    for i in range(1, len(first)):
        first[i] = max(first[i], first[i - 1] + 1)

    captions = []
    for i, g in enumerate(groups):
        flat = [w for u in g for w in u]
        end = frame(flat[-1]["end"] + TAIL_HOLD)
        end = min(max(end, first[i] + min_f), first[i] + max_f)
        if i + 1 < len(groups):
            end = min(end, first[i + 1])
        end = max(end, first[i] + 1)
        captions.append({
            "start": first[i] / fps,
            "end": end / fps,
            "text": "\n".join(" ".join(w["word"] for w in line) for line in _lines(g, cfg)),
            "words": [dict(w) for w in flat],
            "flags": [{"word": w["word"], "p": w["p"], "at": w["start"]} for w in flat if w["p"] < LOW_P],
        })
    return captions


def _srt_time(t):
    ms = max(0, int(math.floor(t * 1000 + 0.5)))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def write_srt(captions, path):
    """UTF-8 with BOM (the form Asistent verified in Premiere), \\n line endings, numbered from 1."""
    # The BOM is written by hand: the "utf-8-sig" codec writes nothing for an empty file.
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\ufeff")
        for n, c in enumerate(captions, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (n, _srt_time(c["start"]), _srt_time(c["end"]), c["text"]))
