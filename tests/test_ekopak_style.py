"""The ЕКОПАК client's subtitle style (docs/SUBTITLE_STYLES/EKOPAK.md): the shared template (capitals, no punctuation, two lines cut
evenly) with green keywords suggested on about one chunk in four, recycling words first."""
import re

from asistent import subtitle_job
from asistent import subtitles as S


def words(text, t=0.0, dur=0.3, gap=0.05):
    out = []
    for tok in text.split():
        out.append({"word": tok, "start": t, "end": t + dur, "p": 0.95})
        t += dur + gap
    return out


def caps_of(text):
    return S.build_captions(words(text), "ekopak", 29.97)


def test_the_style_is_offered_to_the_panel():
    assert "ekopak" in subtitle_job.PRESET_NAMES


def test_capitals_no_punctuation_and_the_name_in_cyrillic():
    caps = caps_of("Хвърляме го в синия контейнер на Ecopack. Чакай, видях един боклук!")
    for c in caps:
        assert c["text"] == c["text"].upper() and not re.search(r"[.,?!…:;]", c["text"])
    assert "ЕКОПАК" in " ".join(c["text"] for c in caps)


def test_two_lines_are_cut_evenly():
    assert S._stacked([[{"word": w}] for w in "ама чакай малко де".split()], S.PRESETS["ekopak"]) == \
        [[{"word": "ама"}, {"word": "чакай"}], [{"word": "малко"}, {"word": "де"}]]


def test_recycling_words_are_suggested_and_never_two_in_a_row():
    groups = [[[{"word": w}] for w in ws.split()] for ws in ("един боклук", "кой видя", "в синия контейнер", "на улицата", "то")]
    picked = S._accents(groups, S.PRESETS["ekopak"])
    assert 0 in picked and 2 in picked
    assert all(b - a >= 2 for a, b in zip(picked, picked[1:]))
