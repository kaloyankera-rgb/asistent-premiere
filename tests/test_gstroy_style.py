"""The GStroy client's subtitle style (docs/SUBTITLE_STYLES/GSTROY.md): capitals, no punctuation, a chunk over 12 characters
stacked with its last word alone underneath, green keywords suggested on the chunk's last word, the usual 0.03 s lead."""
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
    return S.build_captions(words(text, **kw), "gstroy", 29.97)


def test_the_style_is_offered_to_the_panel_and_reshape_is_untouched():
    assert "gstroy" in subtitle_job.PRESET_NAMES
    assert S.PRESETS["reshape"] == {"max_words": 3, "max_chars": 14, "soft_chars": 16, "lines": 1, "line_chars": 25,
                                    "min_s": 0.4, "max_s": 2.5, "phrases": True, "lead": 0.18, "bare": True}


def test_capitals_and_no_punctuation():
    caps = caps_of("При традиционната релсова система, осветителите се закрепват. Добре?")
    for c in caps:
        assert c["text"] == c["text"].upper()
        assert not re.search(r"[.,?!…:;]", c["text"])


def test_a_long_chunk_is_stacked_with_its_last_word_alone_underneath():
    # the editors' own lines: „ПРИ / ТРАДИЦИОННАТА“, „ОЩЕ В / ПРОФИЛИТЕ“
    assert caps_of("при традиционната")[0]["text"] == "ПРИ\nТРАДИЦИОННАТА"
    assert caps_of("още в профилите")[0]["text"] == "ОЩЕ В\nПРОФИЛИТЕ"


def test_a_short_chunk_stays_on_one_line():
    assert caps_of("има разлика")[0]["text"] == "ИМА РАЗЛИКА"          # 11 characters


def test_a_little_word_never_stands_alone_on_the_bottom_line():
    for c in caps_of("осветителят се закрепва с магнит и после осветителят се"):
        lines = c["text"].split("\n")
        if len(lines) == 2:
            assert lines[1].lower() not in S.NON_FINAL


def test_a_number_and_its_unit_stay_together_underneath():
    for c in caps_of("работят с напрежение 220 волта"):
        assert "220\n" not in c["text"]                         # never „220“ above and „ВОЛТА“ below


def test_green_keywords_are_last_words_and_never_two_in_a_row():
    text = ("магнитната релса изглежда по-изчистено в интериора има разлика и в начина по който се закрепва и захранва "
            "осветлението при традиционната релсова система осветителите се закрепват със съвместим адаптер")
    caps = caps_of(text)
    marked = [i for i, c in enumerate(caps) if "accent" in c]
    assert marked
    for i in marked:
        c = caps[i]
        assert c["text"].split()[-1] == c["accent"]               # the chunk's last word, as shown (capitals)
        assert len(c["accent"]) >= 6
    assert all(b - a >= 2 for a, b in zip(marked, marked[1:]))


def test_the_chunk_appears_with_its_first_word_not_ahead_of_it():
    caps = caps_of("|2.0 добре дошли в магазина")
    assert abs(caps[0]["start"] - (2.0 - S.LEAD)) <= 1 / 29.97 + 1e-6


def test_other_presets_mark_no_accents_and_keep_their_case():
    caps = S.build_captions(words("при традиционната релсова система"), "short", 25)
    assert all("accent" not in c for c in caps)
    assert any(ch.islower() for c in caps for ch in c["text"])


def test_the_brand_is_written_gstroy_even_in_capitals_and_from_whisper_s_two_pieces():
    # the user, 2026-11-10: „GStroy“; Whisper writes „G -Stroy“ (two words) or „GStroy“
    for said in ("Ние в G -Stroy ще", "Ние в GStroy ще", "клиент си? G -Stroy."):
        caps = S.build_captions(words(said), "gstroy", 29.97)
        text = " ".join(c["text"] for c in caps)
        assert "GStroy" in text and "GSTROY" not in text and "-STROY" not in text
    joined = S._join_names(words("в G -Stroy, майсторът"), S.PRESETS["gstroy"])
    assert [w["word"] for w in joined] == ["в", "GStroy,", "майсторът"]
    assert joined[1]["start"] == words("в G")[1]["start"] and joined[1]["end"] == words("в G -Stroy,")[2]["end"]


def test_a_lone_dash_is_not_shown():
    text = " ".join(c["text"] for c in S.build_captions(words("Ние сме GStroy – майсторът си ти"), "gstroy", 29.97))
    assert "–" not in text and "GStroy" in text
