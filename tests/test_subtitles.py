"""Subtitle text core on synthetic word lists: spelling, line breaking, presets, frame snapping, flags, SRT."""
import math
import re

import pytest

from asistent import bgtext
from asistent import subtitles as S

FUNCTION = {"във", "в", "или", "за", "на", "и", "с", "със", "от", "до", "по", "при", "към", "че", "не", "да"}
FPS_LIST = [25, 29.97, 30, 59.94]


def words(text, t=0.0, dur=0.3, gap=0.05, lowp=None):
    """Synthetic Whisper words from a string; a token like |0.6 is a pause of that many seconds."""
    out = []
    for tok in text.split():
        if tok.startswith("|"):
            t += float(tok[1:])
            continue
        out.append({"word": tok, "start": t, "end": t + dur, "p": (lowp or {}).get(tok, 0.95)})
        t += dur + gap
    return out


def lines_of(caps):
    return [ln for c in caps for ln in c["text"].split("\n")]


def last_token(line):
    return line.split()[-1].lower().strip(".,?!…")


# --- spelling -------------------------------------------------------------------------------------------

def test_prepositions_follow_the_written_form():
    assert bgtext.fix_text("живея във България със себе си") == "живея в България със себе си"
    assert bgtext.fix_text("в Франция с три монитора") == "във Франция с три монитора"
    assert bgtext.fix_text("със захар и в всеки") == "със захар и във всеки"
    assert bgtext.fix_text("Във Варна") == "Във Варна"
    assert bgtext.fix_text("В Варна") == "Във Варна"
    assert bgtext.fix_text("Със Сашо") == "Със Сашо"
    assert bgtext.fix_text("Със Пешо") == "С Пешо"


def test_spelling_is_applied_to_the_caption_text_not_the_times():
    ws = words("Живея във България и работя със Петър")
    caps = S.build_captions(ws, "standard", 25)
    text = " ".join(c["text"].replace("\n", " ") for c in caps)
    assert "в България" in text and "във България" not in text
    assert "с Петър" in text and "със Петър" not in text
    # the original list is not changed
    assert ws[2]["word"] == "България" and ws[1]["word"] == "във"


# --- numbers and function words stay together -----------------------------------------------------------

@pytest.mark.parametrize("preset", ["short", "standard"])
def test_number_phrases_are_never_split(preset):
    # try every position of the phrases in a running text, so each possible break point is hit
    for pad in range(0, 14):
        filler = " ".join(["разказвам"] * pad)
        ws = words(filler + " Обожавам Формула 1 и купих чашка за 8 евро и после Simucube 25 Nm работи тихо")
        caps = S.build_captions(ws, preset, 25)
        text = "\n".join(c["text"] for c in caps)
        flat = re.sub(r"[ \n]", "_", text)
        for phrase in ("Формула 1", "за 8 евро", "25 Nm"):
            # inside one caption AND on one line: the phrase appears with plain spaces only
            assert any(phrase in ln for ln in lines_of(caps)), (preset, pad, phrase, flat)


@pytest.mark.parametrize("preset", ["short", "standard"])
def test_no_line_ends_in_a_function_word(preset):
    text = ("Мога да ви кажа , че в България или във Франция за състезателни симулатори по принцип "
            "се търси на всяка цена от хората до края и при условие , че с него към финала не губите време "
            "когато играете със приятели за пари или за слава и в крайна сметка печелите")
    caps = S.build_captions(words(text), preset, 25)
    assert caps
    for ln in lines_of(caps):
        assert last_token(ln) not in FUNCTION, ln
    # the pair "и за" / "или за" travels with the word after it
    assert any("или за състезателни" in c["text"] or "за състезателни" in c["text"] for c in caps) or preset == "short"


# --- pauses ---------------------------------------------------------------------------------------------

def test_pause_over_035_splits_and_035_or_less_does_not():
    split = S.build_captions(words("Първо нещо |0.5 второ нещо"), "standard", 25)
    assert [c["text"] for c in split] == ["Първо нещо", "второ нещо"]
    joined = S.build_captions(words("Първо нещо |0.2 второ нещо"), "standard", 25)
    assert len(joined) == 1


# --- short preset ---------------------------------------------------------------------------------------

def test_short_preset_limits():
    text = ("Мерцедес купе симулатор кормило педали седалка монитори кокпит скорост завой спирачка гума "
            "Формула 1 състезателни рамка Heusinkveld педал")
    caps = S.build_captions(words(text, dur=0.4), "short", 25)
    assert len(caps) >= 8
    for c in caps:
        assert "\n" not in c["text"]
        assert len(c["text"].split()) <= 3, c["text"]            # phrases of 2-3 words (4 only with function words or a number)
        assert len(c["text"]) <= 22, c["text"]


# --- standard preset ------------------------------------------------------------------------------------

def test_standard_preset_two_lines_of_42():
    text = ("Когато за първи път седнах в кокпита на симулатора , не очаквах , че кормилото ще ми показва "
            "всяка неравност по пистата . После разбрах колко важна е настройката на педалите и седалката "
            "и защо тези малки детайли решават кой ще спечели състезанието в края на сезона .")
    caps = S.build_captions(words(text, dur=0.35, gap=0.02), "standard", 25)
    assert len(caps) > 2
    two_lines = 0
    for c in caps:
        ls = c["text"].split("\n")
        assert 1 <= len(ls) <= 2
        assert all(len(ln) <= 42 for ln in ls), ls
        two_lines += len(ls) == 2
        assert 1.0 - 1e-9 <= c["end"] - c["start"] <= 6.0 + 1e-9 or c is caps[-1]
    assert two_lines > 0


# --- timing ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("fps", FPS_LIST)
@pytest.mark.parametrize("preset", ["short", "standard"])
def test_frame_snap_durations_and_no_overlap(fps, preset):
    cfg = S.PRESETS[preset]
    real = S.exact_fps(fps)
    # slow speech, quick speech, a word held for 5 s and a few very tight words
    ws = (words("Тук говоря бавно и ясно за всичко това", dur=0.6, gap=0.1)
          + words("а тук много бързо казвам нещо различно", t=12.123, dur=0.1, gap=0.0)
          + words("Дълго", t=20.017, dur=5.0) + words("кратко тихо дума друга", t=27.0031, dur=0.004, gap=0.001))
    caps = S.build_captions(ws, preset, fps)
    assert caps
    for i, c in enumerate(caps):
        for key in ("start", "end"):
            f = c[key] * real
            assert abs(f - round(f)) < 1e-6, (fps, key, c[key])
        assert c["end"] > c["start"]
        dur = c["end"] - c["start"]
        assert dur <= cfg["max_s"] + 1e-9
        nxt = caps[i + 1]["start"] if i + 1 < len(caps) else None
        if nxt is not None:
            assert c["end"] <= nxt + 1e-9
            assert c["start"] < nxt
        # the minimum holds unless the next caption starts sooner
        assert dur >= cfg["min_s"] - 1e-9 or (nxt is not None and abs(c["end"] - nxt) < 1e-9)


def test_captions_stay_close_to_the_speech():
    ws = words("Здравей свят", t=3.0)
    c = S.build_captions(ws, "short", 25)[0]
    assert abs(c["start"] - 3.0) <= 2 / 25                       # appears about a frame before the first word
    assert c["end"] >= ws[-1]["end"]


def test_exact_ntsc_rate():
    assert S.exact_fps(29.97) == pytest.approx(30000 / 1001)
    assert S.exact_fps(59.94) == pytest.approx(60000 / 1001)
    assert S.exact_fps(25) == 25 and S.exact_fps(30) == 30


# --- low-probability words ------------------------------------------------------------------------------

def test_low_probability_words_are_flagged_but_text_is_clean():
    ws = words("Купих Simucube за кокпита си", lowp={"Simucube": 0.31, "кокпита": 0.49, "си": 0.5})
    caps = S.build_captions(ws, "standard", 25)
    flags = [f for c in caps for f in c["flags"]]
    assert sorted(f["word"] for f in flags) == ["Simucube", "кокпита"]
    sim = next(f for f in flags if f["word"] == "Simucube")
    assert sim["p"] == pytest.approx(0.31) and sim["at"] == pytest.approx(ws[1]["start"])
    text = " ".join(c["text"] for c in caps)
    assert "?" not in text and "Simucube" in text


def test_missing_p_counts_as_sure():
    ws = [{"word": "Здравей", "start": 0.0, "end": 0.4}, {"word": "свят", "start": 0.45, "end": 0.9}]
    caps = S.build_captions(ws, "short", 25)
    assert caps and all(c["flags"] == [] for c in caps)


# --- edge cases -----------------------------------------------------------------------------------------

def test_empty_input():
    assert S.build_captions([], "short", 25) == []
    assert S.build_captions(None, "standard", 30) == []
    assert S.build_captions([{"word": "  ", "start": 0, "end": 1}], "short", 25) == []


def test_words_less_than_a_frame_apart_never_give_zero_length():
    ws = [{"word": w, "start": 5.0 + i * 0.002, "end": 5.0 + i * 0.002 + 0.001, "p": 1.0}
          for i, w in enumerate("едно две три четири пет шест".split())]
    caps = S.build_captions(ws, "short", 25)
    for a, b in zip(caps, caps[1:]):
        assert a["start"] < b["start"] and a["end"] <= b["start"] + 1e-9
    assert all(c["end"] > c["start"] for c in caps)


# --- presets and prompt ---------------------------------------------------------------------------------

def test_preset_for_frame_size():
    assert S.preset_for(1080, 1920) == "short"
    assert S.preset_for(1080, 1080) == "short"
    assert S.preset_for(1920, 1080) == "standard"
    assert S.preset_for(None, None) == "short"
    assert S.preset_for(0, 0) == "short"
    assert S.preset_for("x", 1080) == "short"


def test_initial_prompt():
    assert S.initial_prompt(["4a1a Racing", " Simucube 3 Pro ", "simucube 3 pro", "", "Формула 1,"]) == \
        "4a1a Racing, Simucube 3 Pro, Формула 1."
    assert S.initial_prompt([]) == "" and S.initial_prompt(None) == ""


# --- SRT file -------------------------------------------------------------------------------------------

def parse_srt(path):
    with open(path, "rb") as f:
        raw = f.read()
    assert raw[:3] == b"\xef\xbb\xbf"
    assert b"\r" not in raw
    body = raw[3:].decode("utf-8")
    entries = []
    for block in body.strip("\n").split("\n\n") if body.strip() else []:
        ls = block.split("\n")
        m = re.fullmatch(r"(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)", ls[1])
        assert m, ls[1]
        g = [int(x) for x in m.groups()]
        entries.append((int(ls[0]), (g[0] * 3600 + g[1] * 60 + g[2]) + g[3] / 1000.0,
                        (g[4] * 3600 + g[5] * 60 + g[6]) + g[7] / 1000.0, "\n".join(ls[2:])))
    return entries


@pytest.mark.parametrize("fps", [25, 29.97])
def test_srt_roundtrip_with_bom(tmp_path, fps):
    ws = words("Живея във България и обичам Формула 1 повече от всичко на света |0.8 а ти какво мислиш за това "
               "скъпи приятелю , кажи ми честно", t=3661.5)
    caps = S.build_captions(ws, "standard", fps)
    path = tmp_path / "out.srt"
    S.write_srt(caps, str(path))
    back = parse_srt(str(path))
    assert len(back) == len(caps) > 1
    for n, (c, (num, st, en, txt)) in enumerate(zip(caps, back), 1):
        assert num == n
        assert st == pytest.approx(c["start"], abs=0.0006) and en == pytest.approx(c["end"], abs=0.0006)
        assert txt == c["text"]
    assert back[0][1] > 3600  # hours are written
    # a blank line between entries and after the last one
    assert path.read_bytes().endswith(b"\n\n")


def test_srt_empty_is_only_the_bom(tmp_path):
    p = tmp_path / "e.srt"
    S.write_srt([], str(p))
    assert p.read_bytes() == b"\xef\xbb\xbf"


def test_srt_time_format():
    assert S._srt_time(0) == "00:00:00,000"
    assert S._srt_time(3723.0456) == "01:02:03,046"
    assert S._srt_time(-1) == "00:00:00,000"


# --- natural phrases (0.9.44) ---------------------------------------------------------------------------

def spoken(text, t=0.0):
    """A recognised sentence with realistic timing: ~0.3 s per word, a comma pause 0.15 s, a sentence end 0.5 s."""
    out = []
    for tok in text.split():
        d = 0.18 + 0.05 * len(tok.strip(".,?!"))
        out.append({"word": tok, "start": t, "end": t + d, "p": 0.9})
        t += d + (0.5 if tok[-1] in ".?!" else 0.15 if tok.endswith(",") else 0.03)
    return out


SAMPLE = "Имаш идея? Добре, я да видим какво ще трябва. Примерно на мен ми трябва ето това. Я почакай, мога и един раф да направя."


def test_captions_follow_the_phrases_of_the_sentence():
    caps = S.build_captions(spoken(SAMPLE), "short", 25)
    texts = [c["text"] for c in caps]
    assert "Имаш идея?" in texts and any(t.startswith("я да видим") for t in texts)         # a question stays one caption
    for t in texts:
        assert 1 <= len(t.split()) <= 4, t
    two_three = [t for t in texts if 2 <= len(t.split()) <= 3]
    assert len(two_three) >= 0.6 * len(texts), texts


def test_a_caption_never_runs_across_a_sentence_end():
    for c in S.build_captions(spoken(SAMPLE + " " + SAMPLE), "short", 25):
        inner = c["text"][:-1]
        assert not re.search(r"[.?!…]", inner), c["text"]


def test_connected_words_stay_together_in_bulgarian_phrases():
    text = "Мога и един раф да направя. На мен ми трябва ето това. Той ще дойде във Варна със сестра си."
    caps = S.build_captions(spoken(text), "short", 25)
    joined = " | ".join(c["text"] for c in caps)
    for phrase in ("един раф", "ми трябва", "във Варна", "със сестра"):
        assert any(phrase in c["text"] for c in caps), (phrase, joined)
    for c in caps:
        if not re.search(r"[.?!…,]$", c["text"]):                 # a sentence may end on „си.“; a cut inside one may not
            assert c["text"].split()[-1].lower() not in S.NON_FINAL, c["text"]


def test_a_comma_is_a_good_place_to_cut():
    caps = S.build_captions(spoken("Почваш едно, почваш второ, почваш трето и накрая сума ти неща."), "short", 25)
    texts = [c["text"] for c in caps]
    assert texts[:3] == ["Почваш едно,", "почваш второ,", "почваш трето"], texts


def test_continuous_speech_never_blinks_and_a_pause_clears_the_screen():
    ws = spoken("Първо казвам това , после казвам онова") + spoken("След дълга пауза идва нещо ново", t=8.0)
    caps = S.build_captions(ws, "short", 25)
    for a, b in zip(caps, caps[1:]):
        speech_gap = next(w["start"] for w in ws if w["start"] >= b["start"] - 0.05) - max(w["end"] for w in a["words"])
        if speech_gap <= S.CONTINUOUS_GAP:
            assert abs(a["end"] - b["start"]) < 1e-9, (a["text"], b["text"])               # no gap, no blink
        else:
            assert b["start"] - a["end"] > 0.1, (a["text"], b["text"])                       # the screen clears in a real pause
    assert caps[-1]["end"] - caps[-1]["words"][-1]["end"] <= S.TAIL_HOLD + 0.05


def test_a_word_is_not_shown_before_the_previous_one_was_said():
    ws = spoken(SAMPLE)
    caps = S.build_captions(ws, "short", 25)
    for a, b in zip(caps, caps[1:]):
        assert b["start"] >= max(w["end"] for w in a["words"]) - 1 / 25 or abs(a["end"] - b["start"]) < 1e-9


def test_very_short_one_word_captions_are_avoided_when_a_neighbour_can_take_the_word():
    ws = [{"word": "Ей,", "start": 14.43, "end": 14.55, "p": 1}, {"word": "тъй", "start": 14.9, "end": 15.1, "p": 1},
          {"word": "като", "start": 15.12, "end": 15.3, "p": 1}, {"word": "стане,", "start": 15.32, "end": 15.7, "p": 1}]
    caps = S.build_captions(ws, "short", 25)
    assert all(c["end"] - c["start"] >= 0.3 for c in caps), [(c["text"], c["end"] - c["start"]) for c in caps]


def test_a_blank_screen_is_either_a_real_pause_or_none_at_all():
    """Seen on the real clip: „Ей,“ cleared 0.08 s before „то и за градината“ appeared. No blank of 0.2 s or less."""
    ws = [{"word": "Ей,", "start": 11.5, "end": 11.85, "p": 1}, {"word": "то", "start": 12.15, "end": 12.3, "p": 1},
          {"word": "и", "start": 12.3, "end": 12.4, "p": 1}, {"word": "за", "start": 12.4, "end": 12.5, "p": 1},
          {"word": "градината", "start": 12.5, "end": 13.0, "p": 1}, {"word": "трябва", "start": 15.0, "end": 15.4, "p": 1},
          {"word": "нещо.", "start": 15.4, "end": 15.9, "p": 1}]
    caps = S.build_captions(ws, "short", 25)
    for a, b in zip(caps, caps[1:]):
        blank = b["start"] - a["end"]
        assert blank < 1e-9 or blank > S.MIN_CLEAR, (a["text"], b["text"], blank)
    assert caps[0]["end"] == caps[1]["start"]                                 # a 0.3 s pause leaves under 0.2 s of blank after the 0.15 s tail hold: bridged
    assert caps[-2]["end"] - caps[-2]["words"][-1]["end"] <= S.TAIL_HOLD + 0.05          # a real pause (1.7 s) still clears


def _ws(*tokens, step=0.3):
    return [{"word": w, "start": round(i * step, 2), "end": round(i * step + 0.25, 2), "p": 1.0} for i, w in enumerate(tokens)]


def test_tidy_words_attaches_stray_punctuation_and_decimal_parts_without_losing_a_word():
    out, info = S.tidy_words(_ws("Само", "5", ",79,", "ама", "че", "я", "взимаме", ".", "Така"))
    assert [w["word"] for w in out] == ["Само", "5,79,", "ама", "че", "я", "взимаме.", "Така"] and info["joined"] == 2
    assert out[1]["end"] == 0.85                                              # the glued token's time is kept
    out, _ = S.tidy_words(_ws("Колко", "е", "?"))
    assert [w["word"] for w in out] == ["Колко", "е?"]


def test_a_conditional_clause_gets_its_comma_before_the_main_clause_when_whisper_wrote_none():
    out, info = S.tidy_words(_ws("Ако", "е", "под", "700", "евро", "я", "взимаме."))
    assert " ".join(w["word"] for w in out) == "Ако е под 700 евро, я взимаме." and info["commas"] == ["евро,"]
    out, info = S.tidy_words(_ws("Ако", "не", "го", "видиш", "днес", "ще", "му", "кажа."))
    assert " ".join(w["word"] for w in out) == "Ако не го видиш днес, ще му кажа."          # not after „не“
    for sent in (["Ако", "струва", "под", "500", "евро,", "го", "взима."],               # already has one
                 ["Ако", "утре", "не", "го", "видиш", "идвам."],                         # no clitic after enough words
                 ["Тя", "е", "под", "700", "евро", "я", "взимаме."],                      # not a conditional clause
                 ["Ако", "го", "видиш", "кажи", "ми."]):                                  # clitic too early
        out, info = S.tidy_words(_ws(*sent))
        assert [w["word"] for w in out] == sent and info["commas"] == [], sent
