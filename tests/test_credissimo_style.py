"""The Credissimo client's subtitle style (docs/SUBTITLE_STYLES/CREDISSIMO.md): GStroy's look, but the two lines cut where they
come out most even, and red keywords suggested on about one chunk in six (long last words and money words)."""
import re

from asistent import subtitle_job
from asistent import subtitles as S


def words(text, t=0.0, dur=0.3, gap=0.05):
    out = []
    for tok in text.split():
        if tok.startswith("|"):
            t += float(tok[1:])
            continue
        out.append({"word": tok, "start": t, "end": t + dur, "p": 0.95})
        t += dur + gap
    return out


def caps_of(text, **kw):
    return S.build_captions(words(text, **kw), "credissimo", 29.97)


def test_the_style_is_offered_to_the_panel():
    assert "credissimo" in subtitle_job.PRESET_NAMES


def test_capitals_and_no_punctuation():
    for c in caps_of("Ако трябва да взимате пари назаем, от кого бихте взели? Не знам."):
        assert c["text"] == c["text"].upper()
        assert not re.search(r"[.,?!…:;]", c["text"])


def test_two_lines_are_cut_where_they_come_out_most_even():
    # the editors' own lines: „КАКВА СУМА / БИХТЕ МУ ДАЛИ“, „В СЛУЧАЯ / МНОГО ХОРА“ (not the last word alone)
    assert S._stacked([[{"word": w}] for w in "в случая много хора".split()], S.PRESETS["credissimo"]) == \
        [[{"word": "в"}, {"word": "случая"}], [{"word": "много"}, {"word": "хора"}]]
    assert S._stacked([[{"word": w}] for w in "ако трябва да взимате".split()], S.PRESETS["credissimo"]) == \
        [[{"word": "ако"}, {"word": "трябва"}], [{"word": "да"}, {"word": "взимате"}]]


def test_a_tie_gives_the_longer_top_line():
    lines = S._stacked([[{"word": w}] for w in "ааааа бб ааааа".split()], S.PRESETS["credissimo"])
    assert [w["word"] for w in lines[0]] == ["ааааа", "бб"]


def test_a_short_chunk_stays_on_one_line():
    assert caps_of("нищо повече")[0]["text"] == "НИЩО ПОВЕЧЕ"


def test_money_words_are_suggested_even_when_short_and_never_two_in_a_row():
    groups = [[[{"word": w}] for w in ws.split()] for ws in ("аз нямам пари", "от последния", "човек", "за едно кафе", "пари назаем")]
    picked = S._accents(groups, S.PRESETS["credissimo"])
    assert 0 in picked                                          # „пари“: a money word, 4 letters
    assert all(b - a >= 2 for a, b in zip(picked, picked[1:]))


def test_red_keywords_are_the_last_words_as_shown():
    text = ("аз нямам пари ако трябва да взимате пари назаем от последния човек на когото сте писали "
            "какво бихте направили с бюджета си за месеца и колко струва вноската по кредита")
    for c in caps_of(text):
        if "accent" in c:
            assert c["text"].split()[-1] == c["accent"]


def test_gstroy_still_puts_the_last_word_alone_underneath():
    assert S.build_captions(words("при традиционната"), "gstroy", 29.97)[0]["text"] == "ПРИ\nТРАДИЦИОННАТА"


def test_the_brand_is_written_in_latin_however_whisper_wrote_it():
    # the user, 2026-11-10: CREDISSIMO (the exports used both)
    for said in ("Кредисимо", "кредисимо,", "Credissimo."):
        text = S.build_captions(words(f"ние от {said}"), "credissimo", 29.97)[0]["text"]
        assert "CREDISSIMO" in text and "КРЕДИСИМО" not in text
    assert "КРЕДИСИМО" in S.build_captions(words("ние от Кредисимо"), "gstroy", 29.97)[0]["text"]   # other clients untouched
