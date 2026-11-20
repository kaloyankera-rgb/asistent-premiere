"""Layer attribution of the subtitle benchmark (engine/asistent/bench/layers.py). Synthetic sentences only."""
from asistent.bench import layers as L


def W(text: str, step: float = 0.5) -> list[dict]:
    return [{"word": w, "start": round(i * step, 2), "end": round(i * step + 0.4, 2)} for i, w in enumerate(text.split())]


def test_tokens_fold_what_text_recognition_loses_in_capitals():
    assert L.tokens("МОЙ ОБЕКТИВЪТ, ПО-ДОБРЕ!") == L.tokens("мои обективьт по добре") == ["мои", "обективът", "по", "добре"]


def test_a_latin_name_is_one_placeholder_however_it_is_written():
    assert L.tokens("НА IPHONE-А ТИ") == ["на", L.LATIN, "ти"]
    assert L.tokens("Beauty Sector е тук") == [L.LATIN, "е", "тук"]


def test_cyrillic_read_in_lookalike_latin_letters_is_put_back():
    known = lambda w: w in {"храната", "тор"}
    assert L.unlatin("XPAHATA Е ТУК", known) == "ХРАНАТА Е ТУК"
    assert L.unlatin("КAКВО", None) == "КАКВО"                     # both alphabets in one word: always a misread
    assert L.unlatin("HBO И IPHONE", known) == "HBO И IPHONE"      # not a Bulgarian word, or letters Cyrillic does not have
    assert L.unlatin("XPAHATA", None) == "XPAHATA"                 # no dictionary: a pure Latin word is left alone


def test_what_is_on_screen_but_was_not_said_is_left_out_of_the_reference():
    text = "•НА IMG_6409.JPG СЪМ® 11/20/2024 A00000002501 РАЗХОДИТЕ* → 20 ЕВРО 197248 •"
    assert L.reference(text) == "НА СЪМ РАЗХОДИТЕ 20 ЕВРО"
    assert L.reference("XPAHATA® Е ТУК", lambda w: w == "храната") == "ХРАНАТА Е ТУК"


def test_an_english_name_written_in_latin_letters_is_not_a_broken_word():
    r = L.compare("ЕЛА В БЮТИ СЕКТОР ДНЕС", W("ела в бюти сектор днес"), W("ела в Beauty Sector днес"),
                  {"english": [{"from": "бюти сектор", "to": "Beauty Sector", "at": 1.0}]}, [])
    assert r["broken"] == [] and r["fixed"] == []


def test_digits_and_spoken_numbers_are_the_same_words():
    assert L.tokens("20 ЕВРО") == L.tokens("двайсет евро")


def test_alignment_names_every_kind_of_difference():
    ops = L.align(["а", "б", "в", "г"], ["а", "х", "г", "д"])
    assert sorted(op for op, _, _ in ops) == ["del", "equal", "equal", "ins", "sub"]
    assert [(r, h) for op, r, h in ops if op == "equal"] == [(0, 0), (3, 2)]      # three edits either way: the one that keeps „г“


def test_a_moved_word_keeps_one_match():
    assert sorted(op for op, _, _ in L.align(["а", "б"], ["б", "а"])) == ["del", "equal", "ins"]


def test_tally_counts_errors_and_leaves_latin_words_out():
    ref, hyp = L.tokens("купи IPHONE сега много евтино"), L.tokens("купи айфон сега мнго")
    t = L.tally(L.align(ref, hyp), ref, hyp)
    assert (t["words"], t["sub"], t["del"], t["ins"]) == (4, 1, 1, 0)        # айфон for IPHONE is not counted
    assert t["wer"] == 0.5


def test_three_inserted_words_in_a_row_are_an_invented_line():
    ref, hyp = L.tokens("здравей как си"), L.tokens("здравей абонирайте се сега как си")
    assert L.tally(L.align(ref, hyp), ref, hyp)["invented"] == ["абонираите се сега"]      # folded, as every token is


def test_a_repair_that_breaks_a_right_word_is_counted_against_the_repair():
    r = L.compare("ПРИ ИНТУБАЦИЯ СЕ ПОСТАВЯ ТРЪБА", W("при интубация, се поставя тръба"), W("при инкубация, се поставя тръба"),
                  {"spelling": [{"from": "интубация,", "to": "инкубация,"}]}, [])
    assert r["first"]["wer"] == 0.0 and r["final"]["sub"] == 1
    assert r["broken"] == [{"ref": "интубация", "first": "интубация", "final": "инкубация", "cause": "repair"}]
    assert r["fixed"] == []


def test_a_repair_that_fixes_a_wrong_word_is_counted_for_the_repair():
    r = L.compare("ИМА МНОГО НЕЩА", W("има много нища"), W("има много неща"), {"spelling": [{"from": "нища", "to": "неща"}]}, [])
    assert r["fixed"] == [{"ref": "неща", "first": "нища", "final": "неща", "cause": "repair"}]
    assert r["broken"] == []


def test_a_word_changed_inside_a_swapped_piece_with_no_logged_edit_is_a_swap():
    segments = [{"at": 0.0, "start": 10.0, "end": 12.0}, {"at": 2.0, "start": 30.0, "end": 33.0}]
    first = W("какво е то") + [{"word": "карал", "start": 2.2, "end": 2.6}, {"word": "ли", "start": 2.7, "end": 2.8}]
    final = W("какво е то") + [{"word": "кара", "start": 2.2, "end": 2.6}, {"word": "ли", "start": 2.7, "end": 2.8}]
    r = L.compare("КАКВО Е ТО КАРАЛ ЛИ", first, final, {"second_opinions": [[2.0, "B"], [0.0, "A"]]}, segments)
    assert r["broken"] == [{"ref": "карал", "first": "карал", "final": "кара", "cause": "swap"}]


def test_a_change_no_log_explains_is_unlogged():
    r = L.compare("ТОЙ НЕ ЗНАЕ", W("той не знае"), W("той знае"), {"second_opinions": [[0.0, "A"]]}, [{"at": 0.0, "start": 0.0, "end": 2.0}])
    assert r["broken"] == [{"ref": "не", "first": "не", "final": "", "cause": "unlogged"}]


def test_words_wrong_in_both_readings_are_neither_broken_nor_fixed():
    r = L.compare("ПЕТСТОТИН ЕВРО", W("петстотин милиона"), W("петстотин милиона"), {}, [])
    assert r["broken"] == [] and r["fixed"] == [] and r["first"]["sub"] == r["final"]["sub"] == 1
