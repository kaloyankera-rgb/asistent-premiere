"""The AULA client's subtitle style (docs/SUBTITLE_STYLES/AULA.md): the shared template, lines cut evenly, green keywords
suggested on about one chunk in three, English product names in Latin capitals with the Bulgarian article joined by a hyphen
(„IPHONE-А“), the brand AULA.BG."""
import re

from asistent import subtitle_job
from asistent import subtitles as S


def words(text, t=0.0, dur=0.3, gap=0.05):
    out = []
    for tok in text.split():
        out.append({"word": tok, "start": t, "end": t + dur, "p": 0.95})
        t += dur + gap
    return out


def text_of(said, preset="aula"):
    return " / ".join(c["text"].replace("\n", " | ") for c in S.build_captions(words(said), preset, 29.97))


def test_the_style_is_offered_to_the_panel():
    assert "aula" in subtitle_job.PRESET_NAMES


def test_the_brand_is_written_aula_bg():
    # Whisper's forms, heard on the client's exports
    for said in ("последвай aula .bg", "последвай AOL .bg.", "последвай AulaBG за", "валчер от aula .bgm. За", "Последва Яло АБГ за"):
        assert "AULA.BG" in text_of(said), said
    assert "AULA" in text_of("сайта на Aula и")


def test_english_names_in_latin_capitals_with_the_article_joined():
    assert "IPHONE-А" in text_of("Свържи iPhone -а и")
    assert "IPHONE -А" not in text_of("Свържи iPhone -а и")
    assert "SANDBOX-А" in text_of("отвори Sunbox -а и")
    assert "SANDBOX" in text_of("включи Windows Sunbox. Рестартирай")
    assert "GTA VI" in text_of("там в GTA 6 опцията")
    assert "SYSTEM" in text_of("отвори System Settings.")


def test_a_cyrillic_article_after_a_cyrillic_word_is_left_alone():
    # only an English name takes the joined article; a Bulgarian word with a split „-а“ is not glued
    ws = S._join_articles(words("къща -а"), S.PRESETS["aula"])
    assert [w["word"] for w in ws] == ["къща", "-а"]


def test_the_joined_word_runs_from_the_name_to_the_article():
    ws = S._join_articles(words("iPhone -а"), S.PRESETS["aula"])
    assert len(ws) == 1 and ws[0]["start"] == 0.0 and abs(ws[0]["end"] - 0.65) < 1e-9


def test_capitals_and_no_punctuation():
    for c in S.build_captions(words("Свържи iPhone -а и Android -а с кабел, после натисни Allow."), "aula", 29.97):
        assert c["text"] == c["text"].upper() and not re.search(r"[.,?!…:;]", c["text"])


def test_tech_words_are_suggested():
    groups = [[[{"word": w}] for w in ws.split()] for ws in ("отвори настройки", "и", "смени паролата", "на", "за теб")]
    picked = S._accents(groups, S.PRESETS["aula"])
    assert 0 in picked and all(b - a >= 2 for a, b in zip(picked, picked[1:]))


def test_every_client_style_joins_articles_but_not_reshape():
    # the user, 2026-11-10: the other client styles too (0.10.23); ReShape, short and standard stay as they were
    for preset in ("gstroy", "credissimo", "ekopak", "beautysector"):
        assert "IPHONE-А" in text_of("Свържи iPhone -а и", preset), preset
    for preset in ("reshape", "short", "standard"):
        assert "iPhone-а" not in text_of("Свържи iPhone -а и", preset), preset


def test_a_name_keeps_its_own_writing_with_an_article():
    # the client's own brand takes no article (the user, 2026-11-10: "Its not GStroy-A its GStroy")
    assert text_of("при G -Stroy -а сме", "gstroy").replace(" | ", " ") == "ПРИ GStroy СМЕ"
    assert "CREDISSIMO" in text_of("от Credissimo -то идва", "credissimo")
    assert "CREDISSIMO-" not in text_of("от Credissimo -то идва", "credissimo")
    assert "AULA.BG" in text_of("последвай AulaBG -то") and "AULA.BG-" not in text_of("последвай AulaBG -то")
    assert "SANDBOX-А" in text_of("отвори Sunbox -а и")
