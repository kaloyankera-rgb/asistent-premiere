#!/usr/bin/env python3
"""Build engine/asistent/models/english_bg.json.gz: how a Bulgarian writes a common English word in Cyrillic, from its
pronunciation -> the English word (english.py uses it: „бюти“ -> beauty, „спейс“ -> space, „уоркшоп“ -> workshop).

  build_english_index.py <cmudict.dict> <whisper tokenizer.json> [out]

Sources: CMUdict (pronunciations, BSD, github.com/cmusphinx/cmudict; LICENSES.md), the English Hunspell list that ships with
spylls (only real words), and Whisper's own tokenizer as the measure of a COMMON word: a word that is one token for Whisper
is frequent in the speech it learned from („space“, „beauty“, „workshop“ yes; „spay“ no). Two lists:
  strict  the usual Bulgarian spelling of the English sounds (AH а/ъ, ER ър/ер): a lone unknown word may be converted;
  loose   adds the spellings Bulgarian borrowed words take (AH о, ER ор: „сектор“, „дискомфорт“), used only next to an
          English word or for the editor's own names, never on its own.
When two English words share a spelling, the more common one (lower token id) keeps it („прес“: press, not pres).
"""
import gzip
import itertools
import json
import os
import re
import sys

from spylls.hunspell import Dictionary
from tokenizers import Tokenizer

STRICT_V = {"AA": ["а", "о"], "AE": ["е", "а"], "AH": ["а", "ъ"], "AO": ["о"], "AW": ["ау"], "AY": ["ай"], "EH": ["е"],
            "ER": ["ър", "ер"], "EY": ["ей"], "IH": ["и"], "IY": ["и"], "OW": ["оу", "о"], "OY": ["ой"], "UH": ["у"], "UW": ["у"]}
LOOSE_V = {"AH": ["о"], "ER": ["ор"], "AE": ["ъ"]}
CONS = {"B": ["б"], "CH": ["ч"], "D": ["д"], "DH": ["д", "т"], "F": ["ф"], "G": ["г"], "HH": ["х"], "JH": ["дж"], "K": ["к"],
        "L": ["л"], "M": ["м"], "N": ["н"], "NG": ["нг"], "P": ["п"], "R": ["р"], "S": ["с"], "SH": ["ш"], "T": ["т"],
        "TH": ["т", "с"], "V": ["в"], "W": ["у", "в"], "Y": ["й"], "Z": ["з", "с"], "ZH": ["ж"]}
SOFT = {"а": "я", "у": "ю"}                       # Y + vowel: „ю“ (beauty), „я“ (yard)
CAP = 64                                           # renderings per word


def renderings(phones, loose):
    ph = [re.sub(r"\d", "", p) for p in phones]
    parts, i = [], 0
    while i < len(ph):
        p = ph[i]
        vow = lambda q: STRICT_V[q] + (LOOSE_V.get(q, []) if loose else [])          # noqa: E731
        if p == "Y" and i + 1 < len(ph) and ph[i + 1] in STRICT_V:
            parts.append([SOFT[v[0]] + v[1:] if v[0] in SOFT else "й" + v for v in vow(ph[i + 1])])
            i += 2
            continue
        if p == "R" and i > 0 and ph[i - 1] == "ER":                                  # ER R: one р
            i += 1
            continue
        if p == "ER" and i > 0 and ph[i - 1] == "W":                                  # „wor“ is „уор“: work, workshop
            parts.append(["ор"] + vow(p))
            i += 1
            continue
        parts.append(vow(p) if p in STRICT_V else CONS.get(p, [""]))
        i += 1
    return ["".join(c) for c in itertools.islice(itertools.product(*parts), CAP)]


def main(cmu, tokenizer, out):
    here = os.path.dirname(os.path.abspath(sys.modules["spylls"].__file__))
    en = Dictionary.from_files(os.path.join(here, "hunspell", "data", "en", "en_US"))
    tok = Tokenizer.from_file(tokenizer)
    strict, loose = {}, {}
    rank = {}
    for line in open(cmu, encoding="utf-8"):
        w, *phones = line.split("#")[0].split()
        if "(" in w or not re.fullmatch(r"[a-z]{3,}", w) or not en.lookup(w):
            continue
        ids = tok.encode(" " + w, add_special_tokens=False).ids
        if len(ids) != 1:                          # not a common word for Whisper
            continue
        rank[w] = ids[0]
        for target, is_loose in ((strict, False), (loose, True)):
            for r in renderings(phones, is_loose):
                if len(r) >= 3 and (r not in target or rank[w] < rank[target[r]]):
                    target[r] = w
    extra = {k: v for k, v in loose.items() if strict.get(k) != v}
    with gzip.open(out, "wt", encoding="utf-8") as f:
        json.dump({"source": "CMUdict + en_US Hunspell + Whisper tokenizer (scripts/build_english_index.py)",
                   "strict": strict, "loose": extra}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(rank)} common English words, {len(strict)} strict + {len(extra)} loose spellings -> {out} "
          f"({os.path.getsize(out) // 1024} KB)")


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else
         os.path.join(here, "..", "engine", "asistent", "models", "english_bg.json.gz"))
