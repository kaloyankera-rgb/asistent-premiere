"""First-person past forms that carry the speaker's gender („съм свършил“ / „съм свършила“), detected so they can be CHECKED,
never converted (docs/BULGARIAN_TRANSCRIPTION_GUIDE.md §2). Both speakers are in most edits and there is no per-speaker
information, so a form is never rewritten; when two readings of the audio disagree on the gender of the same form, the
word is flagged for review.

Scope: an l-participle (…ал …ял …ил …ъл; feminine …ала …яла …ила …ъла) after „съм“/„бях“ with up to two small words
between („съм вече свършила“). „учител“ (noun) and third person („той е свършил“) are not matched."""
from __future__ import annotations

import re

from .consensus import norm

AUX = {"съм", "бях"}
BETWEEN = {"вече", "не", "още", "току-що", "току", "що", "пак", "все", "почти"}
VOWELS = "аяиъ"


def _masc(t: str) -> bool:
    return len(t) > 3 and t.endswith("л") and t[-2] in VOWELS


def _fem(t: str) -> bool:
    return len(t) > 4 and t.endswith("ла") and t[-3] in VOWELS


def _after_aux(tokens: list[str], i: int) -> bool:
    for back in (1, 2, 3):
        if i - back < 0:
            return False
        if tokens[i - back] in AUX:
            return True
        if tokens[i - back] not in BETWEEN:
            return False
    return False


def forms(words: list[dict]) -> list[tuple[int, str]]:
    """[(index, "m"|"f")] of the first-person participles in a word list."""
    toks = [norm(w["word"]) for w in words]
    out = []
    for i, t in enumerate(toks):
        if _after_aux(toks, i):
            if _fem(t):
                out.append((i, "f"))
            elif _masc(t):
                out.append((i, "m"))
    return out


def disputed(words: list[dict], other: list[dict], within: float = 0.6) -> list[int]:
    """Indexes in `words` of agreement forms whose gender differs from a form in `other` at about the same time."""
    mine, theirs = forms(words), forms(other)
    out = []
    for i, g in mine:
        for j, h in theirs:
            if h != g and abs(words[i]["start"] - other[j]["start"]) <= within:
                out.append(i)
                break
    return out


# ---------------------------------------------------------------- the speaker's own forms (Phase 5, 0.9.96)
# The user's decision 2026-11-04: the editor says once per microphone track who speaks there (a man, a woman, or not set:
# both / unknown). A first-person form that disagrees with the person on that track is changed to theirs, unless the sound
# clearly says the other form (guide §2.3: metadata resolves what the ear cannot; an audible contradiction is kept and
# marked). Never guessed from the voice. Quotes („Тя ми каза: съм готова“) cannot be told apart: a reason to set "both".

def _gradable(core: str, known) -> bool:
    from .bgnorm import _gradable as g
    return g(core, known)


def speaker_forms(words: list[dict], known=None) -> list[tuple[int, str]]:
    """[(index, "m"|"f")] of words that agree with the speaker: the participles of `forms`, and adjectives after
    „съм“/„бях“ („бях доволен“, „съм готова“) when the dictionary says they are adjectives."""
    known = known or _known()
    out = dict(forms(words))
    toks = [norm(w["word"]) for w in words]
    for i in range(len(toks) - 1):
        if toks[i + 1] in AUX and i not in out and (i == 0 or not re.search(r"[.!?…,]$", words[i]["word"])):
            if _fem(toks[i]):
                out[i] = "f"                               # „Казала съм му“
            elif _masc(toks[i]):
                out[i] = "m"
    for i, t in enumerate(toks):
        if i in out or not _after_aux(toks, i) or len(t) < 4 or known(t) is not True:
            continue
        if t.endswith("а") and _gradable(t, known):
            out[i] = "f"
        elif t[-1] not in "аеиоуъюя" and _gradable(t, known):
            out[i] = "m"
    return sorted(out.items())


def _known():
    from . import lexicon
    return lexicon.known


def to_gender(word: str, gender: str, known=None) -> str | None:
    """A first-person form -> the same word for the other gender („направил“ -> „направила“, „отишла“ -> „отишъл“,
    „доволен“ -> „доволна“), punctuation and capital kept; None when no form is sure (the dictionary decides when it is
    there; without it only the regular participles are changed)."""
    known = known or _known()
    from .bgnorm import _like, _split
    core = _split(word)[1].lower()
    if gender == "f":
        cands = [core + "а"]
        if len(core) > 3 and core[-2] in "еъ":
            cands.append(core[:-2] + core[-1] + "а")             # отишъл -> отишла, доволен -> доволна, добър -> добра
    else:
        stem = core[:-1]
        cands = [stem] + ([stem[:-1] + v + stem[-1] for v in "ъе"] if len(stem) > 2 else [])
    have_dict = known("и") is not None
    for c in cands:
        if have_dict:
            ok = known(c) is True
        else:
            ok = c == cands[0] and (_masc(c) if gender == "m" else _fem(c))
        if ok:
            return _like(word, c)
    return None


# ---------------------------------------------------------------- adjective and noun (Phase 6, 0.9.96)
# Marked for the editor, never changed: an ending is one letter of sound, and the sound check cannot hear it reliably
# (Phase 0, 2026-11-04: над/под, сини/синини passed it), so a change could rewrite what the speaker said.
MASC_A = {"баща", "съдия", "колега", "слуга", "владика", "войвода", "чичо", "дядо", "татко", "кумо"}
FEM_CONSONANT = {"нощ", "сол", "кръв", "любов", "есен", "пролет", "мисъл", "смърт", "вещ", "част", "власт", "пещ", "болест",
                 "вест", "съвест", "повест", "прах", "радост", "младост", "старост", "област", "помощ", "мощ", "същност"}
COUNTING = {"два", "три", "четири", "пет", "шест", "седем", "осем", "девет", "десет", "няколко", "колко", "толкова",
            "двата", "трите", "много", "малко"}
NOT_ADJECTIVES = {"как", "така", "тук", "там", "сега", "само", "още", "вече", "все", "пак", "нещо", "някой", "всеки", "кой",
                  "какъв", "каква", "какво", "какви", "такъв", "такава", "такова", "такива", "този", "тази", "това", "тези",
                  "мой", "моя", "мое", "мои", "твой", "твоя", "свой", "своя", "наш", "наша", "ваш", "ваша", "един", "една",
                  "едно", "едни", "друг", "друга", "друго", "други", "цял", "цяла", "цяло", "цели", "сам", "сама", "само",
                  "сами", "всичко", "всички", "нищо", "никой", "къде", "кога", "защо", "колко", "дали"}
_ADJ_ENDINGS = (("ият", "m"), ("ия", "m"), ("ата", "f"), ("ото", "n"), ("ите", "p"), ("а", "f"), ("я", "f"), ("о", "n"), ("и", "p"))
_ADJ_FORM = {"m": "", "f": "а", "n": "о", "p": "и"}


def _adj_class(t: str) -> str | None:
    for end, c in _ADJ_ENDINGS:
        if t.endswith(end):
            return c
    return "m" if t[-1] not in "аеиоуъюя" else None


def _noun_class(t: str) -> str | None:
    if t in MASC_A:
        return "m"
    if t in FEM_CONSONANT or t.endswith("ост"):
        return "f"
    if t.endswith(("та", "то", "те", "ът", "ят")):
        return None                                        # a definite noun: its article is on the adjective before it
    if t.endswith(("ове", "еве", "ища")):
        return "p"                                         # рафтове, мъжеве, огнища: plurals
    last = t[-1]
    if last in "ая":
        return "f"
    if last in "ое":
        return "n"
    if last == "и":
        return "p"
    return "m" if last not in "уъю" else None


def mismatches(words: list[dict], known=None) -> list[tuple[int, str]]:
    """[(index of the adjective, reason)] where an adjective and the noun right after it disagree in gender or number
    („нов стена“). Only plain words both known to the dictionary; not after a number (the count form „два нови телефона“)."""
    known = known or _known()
    if known("и") is None:
        return []
    toks = [norm(w["word"]) for w in words]
    out = []
    for i in range(len(toks) - 1):
        a, n = toks[i], toks[i + 1]
        if len(a) < 3 or len(n) < 3 or not a.isalpha() or not n.isalpha() or (i and toks[i - 1] in COUNTING):
            continue
        if a in NOT_ADJECTIVES or n in NOT_ADJECTIVES:
            continue                                       # „как така“: „кака“ is a word, „как“ is not an adjective
        if words[i]["word"].rstrip()[-1:] in ",.?!…;:":     # a pause in the writing: not one phrase
            continue
        ca, cn = _adj_class(a), _noun_class(n)
        if not ca or not cn or ca == cn or known(a) is not True or known(n) is not True:
            continue
        if ca == "n" and a.endswith(("о", "е")):
            continue                                       # „често изглежда“: the neuter form is also the adverb
        if ca == "p" and cn == "f":
            continue                                       # „нови крака“, „нови телефона“: plurals and the count form end in -а
        if re.search(r"[аеиоуъяю]л[аоие]?$", a):
            continue                                       # „свършил днеска“: a participle, not an adjective before a noun
        if not _gradable(a, known) or _gradable(n, known):
            continue
        out.append((i, f"„{words[i]['word']} {words[i + 1]['word']}“: the endings do not agree (check what was said)"))
    return out
