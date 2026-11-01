"""Spoken Bulgarian for digit strings (numbers.py): so the aligner can place a number where it is pronounced."""
import pytest

from asistent import asr, numbers


@pytest.mark.parametrize("token, spoken", [
    ("0", "нула"), ("5", "пет"), ("10", "десет"), ("11", "единайсет"), ("19", "деветнайсет"), ("20", "двайсет"),
    ("21", "двайсет и едно"), ("71", "седемдесет и едно"), ("100", "сто"), ("101", "сто и едно"), ("125", "сто двайсет и пет"),
    ("200", "двеста"), ("300", "триста"), ("500", "петстотин"), ("700", "седемстотин"), ("1000", "хиляда"),
    ("1250", "хиляда двеста и петдесет"), ("2024", "две хиляди двайсет и четири"),
    ("5,79", "пет и седемдесет и девет"), ("10%", "десет процента"), ("300?", "триста"), ("евро", None), ("1234567", None),
])
def test_numbers_are_spoken_the_colloquial_way(token, spoken):
    assert numbers.spoken_form(token) == spoken


def test_the_map_has_one_entry_per_distinct_number_and_keys_match_what_the_aligner_strips():
    ws = [{"word": "под"}, {"word": "500"}, {"word": "евро,"}, {"word": "300?"}, {"word": "500"}, {"word": "5,79,"}]
    assert numbers.spoken_map(ws) == {"500": "петстотин", "300": "триста", "5,79": "пет и седемдесет и девет"}


def test_parallel_readings_follow_the_machine(monkeypatch):
    monkeypatch.setattr(asr.os, "cpu_count", lambda: 14)
    assert asr._parallelism("cpu") == (5, 2) and asr._parallelism("cuda") == (1, 0)
    monkeypatch.setattr(asr.os, "cpu_count", lambda: 8)
    assert asr._parallelism("cpu") == (2, 3)
    monkeypatch.setattr(asr.os, "cpu_count", lambda: 4)
    assert asr._parallelism("cpu")[0] == 1
