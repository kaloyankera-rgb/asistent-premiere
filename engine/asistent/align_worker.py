"""Forced alignment of Bulgarian words to the sound (MMS_FA, torchaudio). Runs in the OPTIONAL `venv-align`
Python (torch is too big to put in the engine's own environment), started by `align.py`:

    python align_worker.py <dir>      <dir>/audio.npy (float32, 16 kHz mono), words.json, spoken.json -> out.json
    python align_worker.py --serve    the same for one <dir> per line on stdin, the model loaded once (align.py's pool)

Adapted from tools/autoedit/asr.py `align` (the method behind the 4a1a subtitles; same author). Whisper's word
times lead the speech by a median 0.12 s and up to 0.5 s (measured 2026-11-01); the alignment places each word where
it is actually pronounced. Only numpy, json, re, sys and torch/torchaudio are used here: no asistent imports.
"""
import json
import os
import re
import sys

import numpy as np

LAT = {"а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i", "й": "y",
       "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
       "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sht", "ъ": "a", "ь": "y", "ю": "yu", "я": "ya"}


def roman(text):
    s = "".join(LAT.get(c, c) for c in text.lower())
    return re.sub(r"[^a-z' ]", " ", s).split()


_MODEL = []          # the model, loaded once per process (--serve keeps the process for many windows, 0.10.6)


def _model(bundle):
    if not _MODEL:
        _MODEL.append(bundle.get_model())
    return _MODEL[0]


def align(audio, words, spoken):
    """words: [{"text", "start", "end"}]. Returns [{"start", "end", "align"}] (same order); a word without letters
    (a digit string not in `spoken`) comes back with start None and is placed by the caller."""
    import torch
    from torchaudio.pipelines import MMS_FA as bundle
    parts = [roman(spoken.get(w["text"].strip(".,?!…"), w["text"])) for w in words]
    idx = [i for i, p in enumerate(parts) if p]
    flat = [t for i in idx for t in parts[i]]
    out = [{"start": None, "end": None, "align": 0.0} for _ in words]
    if not flat:
        return out
    wav = torch.from_numpy(audio)[None]
    model = _model(bundle)
    with torch.inference_mode():
        emission, _ = model(wav)
        spans = bundle.get_aligner()(emission[0], bundle.get_tokenizer()(flat))
    ratio = wav.shape[1] / emission.shape[1] / bundle.sample_rate
    k = 0
    for i in idx:
        group = spans[k:k + len(parts[i])]
        k += len(parts[i])
        n = sum(len(s) for g in group for s in g)
        out[i] = {"start": round(group[0][0].start * ratio, 3), "end": round(group[-1][-1].end * ratio, 3),
                  "align": round(sum(s.score * len(s) for g in group for s in g) / n, 2),
                  "chars": sum(len(t) for t in parts[i])}
    return out


def main(folder):
    audio = np.load(os.path.join(folder, "audio.npy")).astype(np.float32)
    with open(os.path.join(folder, "words.json"), encoding="utf-8") as f:
        words = json.load(f)
    with open(os.path.join(folder, "spoken.json"), encoding="utf-8") as f:
        spoken = json.load(f)
    res = align(audio, words, spoken)
    with open(os.path.join(folder, "out.json"), "w", encoding="utf-8") as f:
        json.dump(res, f)


def serve():
    """One folder per line on stdin -> "ok" or "error <text>" per line on stdout, until stdin closes (align.py's pool)."""
    for line in sys.stdin:
        folder = line.strip()
        if not folder:
            continue
        try:
            main(folder)
            sys.stdout.write("ok\n")
        except Exception as e:                                   # noqa: BLE001 - the engine falls back to Whisper's times
            sys.stdout.write("error " + str(e).replace("\n", " ")[:300] + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    if sys.argv[1] == "--serve":
        serve()
    else:
        main(sys.argv[1])
