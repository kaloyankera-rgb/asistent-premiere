"""Bulgarian spelling for subtitles (copied from tools/autoedit/bgtext.py, logic unchanged).

Subtitles follow standard spelling, not pronunciation: the speaker may say "във България",
but it is written "в България".
"""
import re

# The prepositions "в/във" and "с/със": the long form is written only before a word that starts with the same
# or a related sound.
#   във: before "в" and "ф" (във всеки, във Франция); в: everywhere else (в България).
#   със: before "с" and "з" (със себе си, със захар); с: everywhere else (с три монитора).
_PREP = {"в": ("във", "вф"), "във": ("във", "вф"), "с": ("със", "сз"), "със": ("със", "сз")}


def _first_letter(word):
    m = re.search(r"[^\W\d_]", word)
    return m.group(0).lower() if m else ""


def fix_prepositions(words):
    """words: a list of word texts. Returns a new list with в/във and с/със corrected."""
    out = list(words)
    for i, w in enumerate(out[:-1]):
        core = w.strip(".,?!…\"'„“")
        key = core.lower()
        if key not in _PREP:
            continue
        long_form, letters = _PREP[key]
        short = long_form[0]
        want = long_form if _first_letter(out[i + 1]) in letters else short
        if want != key:
            fixed = want.capitalize() if core[:1].isupper() else want
            out[i] = w.replace(core, fixed, 1)
    return out


def fix_text(text):
    """Corrects one line of text (words separated by spaces)."""
    return " ".join(fix_prepositions(text.split()))
