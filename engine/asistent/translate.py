"""The English line under every Bulgarian subtitle line (2026-11-04, the user's reference style, docs/SUBTITLE_STYLE.md).

The user's rule: one English line per Bulgarian line, the same number and the same times, translating the same words while still
making sense. So every Bulgarian SENTENCE is translated whole (NLLB-200 600M, local, `<app>/models/nllb-600m-int8`; one sentence per
call: given two, the model dropped the first), and the English sentence is then cut into as many pieces as the sentence has
Bulgarian lines. Where to cut comes from the model's attention (which Bulgarian words each English word was made from), and a cut
after an English comma or full stop is preferred where the Bulgarian line ends with one. Without punctuation the cut can land one
word early or late (measured on the ReShape reference): the editor fixes such a line by hand.
"""
from __future__ import annotations

import os
import re
import threading
import time

import numpy as np

from . import config

MODEL_DIR = "nllb-600m-int8"
MODEL_REPO = "JustFrederik/nllb-200-distilled-600M-ct2-int8"     # CC-BY-NC 4.0 (LICENSES.md); the CTranslate2 int8 conversion
MODEL_FILES = ("config.json", "model.bin", "sentencepiece.bpe.model", "shared_vocabulary.txt")
MODEL_MB = 623
PUNCT = (",", ".", "?", "!", ":", ";")
PUNCT_BONUS = 0.6               # attention mass a matching punctuation cut is worth (one English word carries about 1)
LENGTH_WEIGHT = 0.35            # per word away from the length the Bulgarian line suggests (lone "the" / "an" lines, ReShape test)
DANGLING_PENALTY = 0.8          # a piece may not end on a word that needs the next one
DANGLING = {"the", "a", "an", "of", "to", "in", "on", "at", "for", "with", "by", "from", "into", "and", "or", "but", "as", "that",
            "is", "are", "was", "be", "will", "would", "can", "could", "should", "must", "has", "have", "my", "your", "his", "her",
            "their", "our", "its", "this", "these", "those", "than", "very", "so", "if", "when", "what", "which", "who"}
SENTENCE_END = re.compile(r"[.?!…]+[»\"')]*$")

_lock = threading.Lock()
_state: dict = {}
_cache: dict = {}


def model_dir() -> str:
    return os.path.join(config.app_dir(), "models", MODEL_DIR)


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
    d = model_dir()
    os.makedirs(d, exist_ok=True)
    err: list = []

    def run():
        try:
            snapshot_download(MODEL_REPO, local_dir=d, allow_patterns=list(MODEL_FILES))
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
    if not available():
        raise RuntimeError("The download finished, but translator files are missing.")
    return {"translator": True}


def _load():
    with _lock:
        if "tr" not in _state:
            import ctranslate2
            import sentencepiece as spm
            d = model_dir()
            _state["sp"] = spm.SentencePieceProcessor(model_file=os.path.join(d, "sentencepiece.bpe.model"))
            _state["tr"] = ctranslate2.Translator(d, device="cpu", compute_type="int8", intra_threads=4)
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


def _translate_sentence(lines: list[str]) -> list[str]:
    """One Bulgarian sentence given as its subtitle lines -> one English piece per line."""
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
    cuts = split(M, en_words, [bool(ws) and ws[-1].endswith(PUNCT) for ws in words], [len(ws) for ws in words])
    return [" ".join(en_words[a:b]) for a, b in cuts]


BARE = re.compile(r"[.,!:;…\"“”]+(?=\s|$)")


def bare(text: str) -> str:
    """An English line in a style without punctuation: the marks go, a question keeps its "?" (the client's videos)."""
    return " ".join(BARE.sub("", text).split())


def english_lines(lines: list[str]) -> list[str]:
    """Bulgarian subtitle lines (in order) -> the English line for each, the same number. Line breaks inside a line are spaces."""
    flat = [" ".join(str(t).split()) for t in lines]
    out = [""] * len(flat)
    for group in sentences(flat):
        key = tuple(flat[i] for i in group)
        if key not in _cache:
            _cache[key] = _translate_sentence(list(key))
        for i, en in zip(group, _cache[key]):
            out[i] = en
    return out
