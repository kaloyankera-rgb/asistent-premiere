"""Phase 8 M3: repeated takes, false starts and restarts found in recognised words, and what is cut for them."""
import numpy as np

from asistent import pauses, speechmap, takes


def say(*lines, t=0.0, gap=1.0):
    """Lines of text -> timed words (0.3 s per word, `gap` seconds between lines)."""
    words = []
    for line in lines:
        for w in line.split():
            words.append({"word": w, "start": round(t, 3), "end": round(t + 0.3, 3), "p": 0.9})
            t += 0.32
        t += gap
    return words


def test_sentences_end_on_marks_and_pauses():
    s = takes.sentences(say("Днес ще ви покажа. Три неща", "Втори ред"))
    assert [x["text"] for x in s] == ["Днес ще ви покажа.", "Три неща", "Втори ред"]
    assert s[0]["ends"] and not s[1]["ends"]


def test_exact_repeat_recommends_the_last_take():
    g = takes.find(say("Днес ще ви покажа три неща.", "Днес ще ви покажа три неща."))
    assert len(g) == 1 and g[0]["kind"] == "exact"
    assert len(g[0]["takes"]) == 2 and g[0]["recommended"] == 1 and g[0]["safe"]


def test_short_sentences_are_never_matched():
    assert takes.find(say("Добре.", "Добре.", "Така.", "Така.", "Добре.")) == []


def test_near_repeat_with_a_changed_word_is_found():
    g = takes.find(say("Ако струва под двеста евро тогава я взимаме.", "Ако струва под двеста евро тогава ще я взимаме."))
    assert [x["kind"] for x in g] == ["near"] and g[0]["safe"]


def test_a_different_number_is_a_review_not_a_safe_repeat():
    g = takes.find(say("Ако тази табуретка струва под 200 евро я взимаме.", "Ако тази табуретка струва под 300 евро я взимаме."))
    assert len(g) == 1 and not g[0]["safe"] and "300" in g[0]["lost"] or "200" in g[0]["lost"]


def test_false_start_is_found_when_said_again_at_once():
    g = takes.find(say("Днес ще ви", "Днес ще ви покажа три неща."))
    assert [x["kind"] for x in g] == ["false_start"] and g[0]["recommended"] == 1


def test_a_start_said_again_a_minute_later_is_not_a_false_start():
    words = say("Днес ще ви", "Тук е нещо съвсем различно и дълго казано накрая.", gap=30.0) + []
    later = say("Днес ще ви покажа три неща.", t=words[-1]["end"] + 30.0)
    assert takes.find(words + later) == []


def test_a_passage_said_three_times_is_one_group_with_three_takes():
    first = say("Виж тази чиния. Ако е под седемстотин евро я взимаме.", "Как седемстотин евро? Тя да не е антика.")
    second = say("Виж тази чиния. Ако е под седемстотин евро я взимаме.", "Как седемстотин евро? Тя да не е антика.", t=20)
    third = say("Виж тази чиния. Ако е под седемстотин евро я взимаме.", "Как седемстотин евро? Тя да не е антика.", t=40)
    g = takes.find(first + second + third)
    assert len(g) == 1 and len(g[0]["takes"]) == 3 and g[0]["recommended"] == 2
    assert g[0]["takes"][0]["start"] < 1 and g[0]["takes"][2]["end"] > 40


def test_a_take_with_an_extra_sentence_in_the_middle_stays_one_take():
    a = say("Ако е под седемстотин евро я взимаме.", "Как седемстотин евро?", "Тя да не е антика.")
    b = say("Ако е под седемстотин евро я взимаме.", "Как седемстотин евро?", "Вижте каква е хубава.", "Тя да не е антика.", t=20)
    g = takes.find(a + b)
    assert len(g) == 1 and len(g[0]["takes"]) == 2
    assert "хубава" in g[0]["takes"][1]["text"]


def test_the_last_take_is_not_recommended_when_it_breaks_off():
    full = say("Днес ще ви покажа три неща за пари днес.")
    cut = say("Днес ще ви покажа три", t=20)
    g = takes.find(full + cut)
    assert len(g) == 1 and g[0]["recommended"] == 0


def test_a_start_repeated_inside_a_sentence_is_a_restart():
    words = say("днес ще ви", t=0, gap=0.4) + say("ъъ", t=1.4, gap=0.0) + say("днес ще ви покажа три неща.", t=2.0)
    g = takes.find(words)
    assert [x["kind"] for x in g] == ["restart"]
    assert g[0]["takes"][0]["text"].startswith("днес ще ви") and g[0]["recommended"] == 1


def test_the_same_words_with_other_words_between_are_not_a_restart():
    words = say("ако струва под 500 евро го взимаме как така 500 евро за одяло.")
    assert takes.find(words) == []


def test_nothing_is_found_in_plain_speech():
    assert takes.find(say("Първо искам да ви кажа нещо важно.", "После ще покажа как работи системата.", "Накрая ви благодаря.")) == []


def test_a_plain_repeat_is_cut_from_the_first_take_to_the_winner_over_setup_talk():
    a = say("Виж тази чиния. Ако е под седемстотин евро я взимаме.")
    talk = say("Добре, готови?", "Тихо.", t=10)
    b = say("Виж тази чиния. Ако е под седемстотин евро я взимаме.", t=20)
    g = takes.find(a + talk + b)
    assert len(g) == 1 and g[0]["whole"] and g[0]["cut"] == [(a[0]["start"], b[0]["start"])]


def test_long_other_talk_between_takes_keeps_it_and_cuts_only_the_losing_take():
    a = say("Виж тази чиния. Ако е под седемстотин евро я взимаме.")
    talk = say("Това е съвсем друга история за магазина и хората, които идват тук всеки ден.", t=10)
    b = say("Виж тази чиния. Ако е под седемстотин евро я взимаме.", t=20)
    g = takes.find(a + talk + b)
    assert len(g) == 1 and not g[0]["whole"] and g[0]["cut"] == [(a[0]["start"], a[-1]["end"])]


def test_a_group_said_differently_is_not_cut():
    g = takes.find(say("Ако тази табуретка струва под 200 евро я взимаме.", "Ако тази табуретка струва под 300 евро я взимаме."))
    assert g[0]["cut"] == []


def test_an_opening_said_in_other_words_belongs_to_its_take():
    a = say("Вижте тези чини! Ако са под 700 евро, ги взимаме.", "Как 700 евро? Тя да не е антика.")
    b = say("Виж тази чиния. Ако е под 700 евро, да я взимаме.", "Как 700 евро? Тя да не е антика.", t=20)
    c = say("Виж тази чиния колко е прекрасна! Ако е под 700 евро я взимаме.", "Как 700 евро? Тя да не е антика.", t=40)
    g = takes.find(a + b + c)
    assert len(g) == 1 and len(g[0]["takes"]) == 3
    assert g[0]["takes"][0]["text"].startswith("Вижте тези чини!") and g[0]["safe"] and g[0]["recommended"] == 2
    assert g[0]["cut"] == [(a[0]["start"], c[0]["start"])]


def test_words_said_a_little_differently_are_not_lost_content():
    assert takes._word_like("вижте", "виж") and takes._word_like("тези", "тази") and not takes._word_like("200", "300")
    assert takes._loose(["вижте", "тези", "чини"], ["виж", "тази", "чиния"]) == 1.0


def test_a_restart_carries_the_cut_of_its_first_copy():
    words = say("днес ще ви", t=0, gap=0.4) + say("ъъ", t=1.4, gap=0.0) + say("днес ще ви покажа три неща.", t=2.0)
    g = takes.find(words)
    assert g[0]["cut"] == [(0.0, 2.0)]


def test_the_take_cut_takes_the_breath_before_the_first_take_and_stops_before_the_winner():
    o, n = 0.0, 1000                                            # 10 s map: speech 1-2 s, breath 2.5-3 s, take 3-4 s, winner 6-7 s
    labels = np.full(n, speechmap.SILENT, dtype=np.int8)
    labels[100:200] = speechmap.WORD
    labels[250:300] = speechmap.LOW
    labels[300:400] = speechmap.WORD
    labels[580:600] = speechmap.LOW
    labels[600:700] = speechmap.WORD
    sm = {"labels": labels, "origin": o}
    words = [{"word": "преди.", "start": 1.0, "end": 2.0}, {"word": "дубъл", "start": 3.1, "end": 4.0}, {"word": "дубъл", "start": 6.1, "end": 7.0}]
    a, b = pauses.take_edges(3.1, 6.1, sm, words)
    assert abs(a - 2.48) < 0.011                                # the breath before the take goes with it
    assert abs(b - (6.0 - pauses.LEAD_IN)) < 0.011              # the winner's first sound (Whisper said 6.1) keeps its lead
    assert a > 2.0                                               # never into the word before
