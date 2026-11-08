"""The English line under every Bulgarian subtitle line (2026-11-04, the user's reference style, docs/SUBTITLE_STYLE.md).

The user's rule: one English line per Bulgarian line, the same number and the same times, translating the same words while still
making sense. So every Bulgarian SENTENCE is translated whole (NLLB-200 1.3B, local, `<app>/models/nllb-1.3b-int8`; one sentence per
call: given two, the model dropped the first, and the previous sentence given as a forced start made it stop early), and the
English sentence is then cut into as many pieces as the sentence has
Bulgarian lines. Where to cut comes from the model's attention (which Bulgarian words each English word was made from), and a cut
after an English comma or full stop is preferred where the Bulgarian line ends with one. Without punctuation the cut can land one
word early or late (measured on the ReShape reference): the editor fixes such a line by hand.

1.3B since 0.9.97 (the user, 2026-11-04: "просто с отслабване" is "just by losing weight", not "just by weakening"). On the
ReShape video it got the meaning right where 600M did not (also „мастните клетки не са просто по-големи“, „лесно синини“), at
about twice the time. A computer that has only the 600M model keeps using it until the bigger one is downloaded.
"""
from __future__ import annotations

import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from . import config, pins

MODEL_DIR = "nllb-1.3b-int8"
MODEL_REPO = "JustFrederik/nllb-200-distilled-1.3B-ct2-int8"     # CC-BY-NC 4.0 (LICENSES.md); the CTranslate2 int8 conversion
MODEL_FILES = ("config.json", "model.bin", "sentencepiece.bpe.model", "shared_vocabulary.txt")
MODEL_MB = 1390
SLOTS = 3                       # sentences translated at the same time (3 x 4 threads; the M4 Max has 10 performance cores)
SMALL_DIR = "nllb-600m-int8"     # the model before 0.9.97: still used where the 1.3B one is not downloaded
PUNCT = (",", ".", "?", "!", ":", ";")
PUNCT_BONUS = 0.6               # attention mass a matching punctuation cut is worth (one English word carries about 1)
LENGTH_WEIGHT = 0.35            # per word away from the length the Bulgarian line suggests (lone "the" / "an" lines, ReShape test)
DANGLING_PENALTY = 0.8          # a piece may not end on a word that needs the next one
DANGLING = {"the", "a", "an", "of", "to", "in", "on", "at", "for", "with", "by", "from", "into", "and", "or", "but", "as", "that",
            "is", "are", "was", "be", "will", "would", "can", "could", "should", "must", "has", "have", "my", "your", "his", "her",
            "their", "our", "its", "this", "these", "those", "than", "very", "so", "if", "when", "what", "which", "who",
            # „does not / mean“, „can / look different“, „not just / bigger“ (the user, 2026-11-04)
            "not", "don't", "doesn't", "didn't", "isn't", "aren't", "wasn't", "won't", "can't", "cannot", "may", "might", "do",
            "does", "did", "were", "been", "had", "just", "also", "even", "more", "most", "less", "really", "such", "some", "any",
            "no", "every", "each", "about", "through", "without", "like", "because", "while", "where", "how", "it's", "they're"}
SENTENCE_END = re.compile(r"[.?!…]+[»\"')]*$")
HINT = 2.0                      # attention mass a word gets toward the line whose own translation has it („the fat cells“)
STOP = {"the", "a", "an", "of", "to", "in", "on", "at", "and", "or", "is", "are", "it", "it's", "that", "this", "with", "by",
        "for", "be", "as", "but", "not", "just", "so", "they", "we", "you", "he", "she", "i", "its", "their", "our", "your", "from"}
# plain words for the viewer where the translator picks a specialist's one (the user, 2026-11-04: "fat tissue", not "adipose");
# the editors' own word fixes are learned per client on top of these (learning.py, english_word)
PLAIN = {"adipose": "fat"}

_lock = threading.Lock()
_state: dict = {}
_cache: dict = {}


def _dir(name: str) -> str:
    return os.path.join(config.app_dir(), "models", name)


def model_dir() -> str:
    """The 1.3B model's folder where it is downloaded, else the 600M one's (the download always goes to the 1.3B folder)."""
    for name in (MODEL_DIR, SMALL_DIR):
        if os.path.isfile(os.path.join(_dir(name), "model.bin")):
            return _dir(name)
    return _dir(MODEL_DIR)


def better_available() -> bool:
    """Only the 600M model is here: the panel offers the 1.3B one."""
    return available() and model_dir() != _dir(MODEL_DIR)


def available() -> bool:
    if not os.path.isfile(os.path.join(model_dir(), "model.bin")):
        return False
    try:
        import ctranslate2  # noqa: F401
        import sentencepiece  # noqa: F401
    except ImportError:
        return False
    return True


def _bytes_on_disk(d: str) -> int:
    total = 0
    for root, _, files in os.walk(d):
        total += sum(os.path.getsize(os.path.join(root, f)) for f in files)
    return total


def download_model(progress, cancelled) -> dict:
    """Download the translator into `model_dir()` (resumable). Only from the panel's own button, like the speech model."""
    from huggingface_hub import snapshot_download
    d = _dir(MODEL_DIR)
    os.makedirs(d, exist_ok=True)
    err: list = []

    def run():
        try:
            snapshot_download(MODEL_REPO, local_dir=d, allow_patterns=list(MODEL_FILES), revision=pins.NLLB_REVISION)   # one commit
        except BaseException as e:                              # noqa: BLE001 - reported below
            err.append(e)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    while t.is_alive():
        if cancelled():
            raise InterruptedError("Cancelled: the download continues next time.")
        mb = _bytes_on_disk(d) / 1e6
        progress(min(mb / MODEL_MB, 0.99), f"Downloading the translator: {mb:.0f} of about {MODEL_MB} MB")
        time.sleep(1.0)
    if err:
        raise RuntimeError(f"The download failed: {err[0]}")
    bad = pins.verify(d, pins.NLLB_SHA256)                      # 0.10.6: exactly the files Asistent was tested with
    if bad:
        raise RuntimeError(f"The downloaded translator does not match its checksum ({', '.join(bad)}): press Download again.")
    if not os.path.isfile(os.path.join(d, "model.bin")) or not available():
        raise RuntimeError("The download finished, but translator files are missing.")
    return {"translator": True}


def _load():
    with _lock:
        d = model_dir()
        if _state.get("dir") != d:                     # first use, or the 1.3B model was downloaded since
            import ctranslate2
            import sentencepiece as spm
            _state["sp"] = spm.SentencePieceProcessor(model_file=os.path.join(d, "sentencepiece.bpe.model"))
            # SLOTS sentences at the same time, each with its own 4 threads (the same 4 as one at a time: the same English)
            _state["tr"] = ctranslate2.Translator(d, device="cpu", compute_type="int8", intra_threads=4, inter_threads=SLOTS)
            _state["dir"] = d
            _cache.clear()
        return _state["sp"], _state["tr"]


def sentences(lines: list[str]) -> list[list[int]]:
    """Line indexes grouped into sentences: a line ending in . ? ! closes one (the last group may stay open)."""
    out, cur = [], []
    for i, text in enumerate(lines):
        cur.append(i)
        if SENTENCE_END.search(text.strip()):
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


def split(mass: np.ndarray, en_words: list[str], ends_punct: list[bool], bg_len: list[int] | None = None) -> list[tuple[int, int]]:
    """Cut the English words into one run per Bulgarian line, in order.

    mass: (English words x Bulgarian lines) attention shares, each row summing to 1. ends_punct: whether each Bulgarian line ends with
    punctuation; bg_len: its number of words. Every line gets at least one word when there are enough words. A cut is worth the
    attention it collects, plus a matching punctuation cut, minus the distance from the length the Bulgarian line suggests and a
    penalty for ending on a word like "the" (attention alone gave lone "the" and "an" lines on the ReShape reference).
    -> [(start, end)] word ranges, one per line.
    """
    n, k = len(en_words), len(ends_punct)
    bg_len = bg_len or [1] * k
    ratio = n / max(sum(bg_len), 1)
    bare = [w.lower().strip(",.?!:;\"'") for w in en_words]

    def piece(s: int, i: int, j: int) -> float:
        v = float(mass[s:i, j - 1].sum()) - LENGTH_WEIGHT * abs((i - s) - ratio * bg_len[j - 1])
        if j < k and i > s and bare[i - 1] in DANGLING and not en_words[i - 1].endswith(PUNCT):
            v -= DANGLING_PENALTY
        return v

    if k == 1:
        return [(0, n)]
    need = 1 if n >= k else 0                       # fewer English words than lines (rare): some lines stay empty
    best = np.full((n + 1, k + 1), -1e9)
    best[0, 0] = 0.0
    back: dict = {}
    for j in range(1, k + 1):
        lo = j * need
        hi = n - (k - j) * need
        for i in range(lo, hi + 1):
            if j == k and i != n:
                continue
            for s in range((j - 1) * need, i - need + 1):
                if best[s, j - 1] <= -1e8:
                    continue
                v = best[s, j - 1] + piece(s, i, j)
                if j < k and ends_punct[j - 1] and i > 0 and en_words[i - 1].endswith(PUNCT):
                    v += PUNCT_BONUS
                if v > best[i, j]:
                    best[i, j] = v
                    back[(i, j)] = s
    cuts, i = [], n
    for j in range(k, 0, -1):
        s = back[(i, j)]
        cuts.append((s, i))
        i = s
    return cuts[::-1]


def _core(w: str) -> str:
    return re.sub(r"[^\w']", "", w.lower())


def replace_words(en_words: list[str], M: np.ndarray, fixes: dict) -> tuple[list[str], np.ndarray]:
    """The English words with every fix applied ({words as translated: as wanted}, one or more words each; case and the
    punctuation around them kept). A new word takes the attention of the words it replaces, so the cut still follows the
    Bulgarian lines."""
    if not fixes:
        return en_words, M
    out, rows, i = [], [], 0
    pats = sorted(((k.split(), v.split()) for k, v in fixes.items()), key=lambda kv: -len(kv[0]))
    while i < len(en_words):
        for old, new in pats:
            n = len(old)
            if [_core(w) for w in en_words[i:i + n]] == [_core(w) for w in old] and new:
                lead = re.match(r"^\W*", en_words[i]).group(0)
                tail = re.search(r"[^\w']*$", en_words[i + n - 1]).group(0)
                new = list(new)
                if en_words[i][len(lead):len(lead) + 1].isupper():
                    new[0] = new[0][:1].upper() + new[0][1:]
                new[0], new[-1] = lead + new[0], new[-1] + tail
                out += new
                rows += [M[i:i + n].mean(axis=0)] * len(new)
                i += n
                break
        else:
            out.append(en_words[i])
            rows.append(M[i])
            i += 1
    return out, np.asarray(rows)


def _translate_sentence(lines: list[str], fixes: dict | None = None) -> list[str]:
    """One Bulgarian sentence given as its subtitle lines -> one English piece per line.

    Every line is also translated on its own: its words tell which English words belong to it (2026-11-04: "the fat | cells
    aren't just bigger" became "the fat cells | aren't just bigger"). Choosing among the model's other sentences by these
    words was tried and dropped: it made other sentences worse."""
    sp, tr = _load()
    words = [line.split() for line in lines]
    src, owner = [], []
    for li, ws in enumerate(words):
        for w in ws:
            pieces = sp.encode(w, out_type=str)
            src += pieces
            owner += [li] * len(pieces)
    if not src:
        return ["" for _ in lines]
    res = tr.translate_batch([src + ["</s>", "bul_Cyrl"]], target_prefix=[["eng_Latn"]], beam_size=4,
                             max_decoding_length=256, return_attention=True)[0]
    hints = [set() for _ in lines]
    if len(lines) > 1:
        own = tr.translate_batch([[p for w in ws for p in sp.encode(w, out_type=str)] + ["</s>", "bul_Cyrl"] for ws in words],
                                 target_prefix=[["eng_Latn"]] * len(words), beam_size=2, max_decoding_length=64)
        hints = [{c for c in map(_core, sp.decode(r.hypotheses[0][1:]).split()) if c and c not in STOP} for r in own]
    hyp = res.hypotheses[0]
    hyp = hyp[1:] if hyp and hyp[0] == "eng_Latn" else hyp
    att = np.asarray(res.attention[0], dtype=np.float64)
    en_words: list[str] = []
    mass: list[np.ndarray] = []
    owner_arr = np.asarray(owner)
    for ti, tok in enumerate(hyp):
        row = att[min(ti, len(att) - 1), :len(src)]           # the row of the step that produced this token (offset 0, measured)
        m = np.bincount(owner_arr, weights=row, minlength=len(lines))
        if tok.startswith("▁") or not en_words:
            en_words.append(tok.lstrip("▁"))
            mass.append(m)
        else:
            en_words[-1] += tok
            mass[-1] = mass[-1] + m
    keep = [i for i, w in enumerate(en_words) if w]
    en_words = [en_words[i] for i in keep]
    if not en_words:
        return ["" for _ in lines]
    M = np.asarray([mass[i] for i in keep])
    M = M / (M.sum(axis=1, keepdims=True) + 1e-12)
    fixes = {**PLAIN, **(fixes or {})}
    en_words, M = replace_words(en_words, M, fixes)    # first, so the plain word meets the line's own translation of it
    hints = [{_core(w) for w in replace_words(sorted(h), np.zeros((len(h), 1)), fixes)[0]} for h in hints]
    for i, w in enumerate(en_words):                  # a word the line's own translation has leans to that line
        owners = [j for j, h in enumerate(hints) if _core(w) in h]
        if 0 < len(owners) < len(lines):
            M[i, owners] += HINT / len(owners)
    M = M / (M.sum(axis=1, keepdims=True) + 1e-12)
    cuts = split(M, en_words, [bool(ws) and ws[-1].endswith(PUNCT) for ws in words], [len(ws) for ws in words])
    return [" ".join(en_words[a:b]) for a, b in cuts]


BARE = re.compile(r"[.,!:;…\"“”]+(?=\s|$)")


def bare(text: str) -> str:
    """An English line in a style without punctuation: the marks go, a question keeps its "?" (the client's videos)."""
    return " ".join(BARE.sub("", text).split())


def english_lines(lines: list[str], fixes: dict | None = None) -> list[str]:
    """Bulgarian subtitle lines (in order) -> the English line for each, the same number. Line breaks inside a line are spaces.
    fixes: English words the editors changed ({as translated: as wanted}), applied before the sentence is cut."""
    flat = [" ".join(str(t).split()) for t in lines]
    out = [""] * len(flat)
    if any(flat):
        _load()                                        # a newly downloaded model empties the cache of the old one's lines
    fx = tuple(sorted((fixes or {}).items()))
    groups = sentences(flat)
    keys = [(tuple(flat[i] for i in group), fx) for group in groups]
    todo = list(dict.fromkeys(k for k in keys if k not in _cache))
    if todo:
        with ThreadPoolExecutor(max_workers=SLOTS) as pool:
            for k, en in zip(todo, pool.map(lambda k: _translate_sentence(list(k[0]), dict(k[1])), todo)):
                _cache[k] = en
    for group, key in zip(groups, keys):
        for i, en in zip(group, _cache[key]):
            out[i] = en
    return out
