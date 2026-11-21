"""Recognition profiles (engine/asistent/recognition.py, 0.10.119): one profile per run, the ReShape style frozen.

The ReShape golden run covers one recording in one window; these tests pin what it cannot: the CLASSIC profile field by
field, the cache keys, the call to Whisper, the sound it is given and the keys of the result, whatever a development
switch asks for. Whisper is faked."""
import dataclasses
import json

import numpy as np
import pytest

import synth
from asistent import align, asr, config, lexicon, recognition as R, subtitle_job
from asistent.consensus import norm

RESULT_KEYS = {"asr_seconds", "cached", "captions", "correction_errors", "corrections", "counts", "duplicates", "edits",
               "english_learned", "english_note", "fps", "items", "json", "learning", "mix_seconds", "notes", "origin", "preset",
               "readings", "review", "segments", "skipped", "speakers", "srt", "srt_en", "timing", "tracks", "verbatim", "words"}
EDIT_KEYS = {"corrections", "writing", "english", "speaker_forms", "spelling", "commas", "joined_tokens", "second_opinions",
             "review", "learned", "learned_refused"}
WORDS = [{"word": "Здравейте", "start": 4.5, "end": 5.0, "p": 0.95}, {"word": "приятели", "start": 5.0, "end": 5.6, "p": 0.3},
         {"word": "днес", "start": 6.4, "end": 6.8, "p": 0.9}]       # the piece starts 4 s into its window
RUN = (lambda f, m: None, lambda: False)


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "app_dir", lambda: str(tmp_path / "app"))
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    monkeypatch.setattr(asr, "model_present", lambda: True)
    monkeypatch.delenv("ASISTENT_RECOGNITION", raising=False)
    monkeypatch.setattr(align, "unheard", lambda y, ws, sr=16000: ([dict(w) for w in ws], []))
    monkeypatch.setattr(align, "available", lambda: False)
    monkeypatch.setattr(align, "trim_silence", lambda y, ws, sr=16000: ([dict(w) for w in ws], 0))
    return tmp_path


def fresh_cache(home, monkeypatch, name):
    monkeypatch.setattr(config, "app_dir", lambda: str(home / name))


def body(home, **kw):
    """Four seconds from the middle of a 12 s recording, placed at 3 s in the sequence: the window Whisper reads (the piece
    with 4 s around it) is not the same sound as the piece read alone (2 s around it)."""
    a = synth.write_wav(home / "a.wav", [synth.talker(12, 1)])
    out = home / "project"
    out.mkdir(exist_ok=True)
    return {"items": [{"path": a, "start": 5.0, "end": 9.0, "at": 3.0, "name": "A"}], "out_dir": str(out), "name": "seq",
            "fps": 25, "width": 1080, "height": 1920, **kw}


def saved(res):
    with open(res["json"], encoding="utf-8") as f:
        return json.load(f)


# ---------------------------------------------------------------- the profiles themselves

def test_classic_is_exactly_the_reshape_style_that_was_approved():
    assert dataclasses.asdict(R.CLASSIC) == {"name": "classic", "strict": False, "second": "doubts", "repair": "steps",
                                             "level": None, "highpass": None, "decode": (), "full": False, "hotwords": False, "part": None, "log": False, "cloud": ""}
    assert R.CLASSIC.tag == "" and R.CLASSIC.options("А, Б.") is None


def test_strict_is_every_other_style_as_shipped_in_0_10_95():
    assert dataclasses.asdict(R.STRICT) == {"name": "strict", "strict": True, "second": "sound", "repair": "steps",
                                            "level": None, "highpass": None, "decode": (), "full": False, "hotwords": False, "part": None, "log": False, "cloud": ""}
    assert R.STRICT.tag == "" and R.STRICT.options("А, Б.") is None


def test_next_is_the_local_path_still_being_measured_and_not_yet_the_default():
    assert dataclasses.asdict(R.NEXT) == {"name": "next", "strict": True, "second": "alone", "repair": "careful+ear",
                                          "level": None, "highpass": None, "decode": (), "full": True, "hotwords": False, "part": None, "log": True, "cloud": ""}
    assert R.NEXT.tag != ""                                   # full precision hears differently: its readings have their own keys
    assert R.DEFAULT is R.STRICT                              # on this computer every style but ReShape's reads as shipped


def test_cloud_reads_once_through_elevenlabs_and_leaves_the_words_as_read():
    assert dataclasses.asdict(R.CLOUD) == {"name": "cloud", "strict": True, "second": "none", "repair": "none",
                                           "level": None, "highpass": None, "decode": (), "full": False, "hotwords": False, "part": None, "log": True, "cloud": "scribe_v3"}
    assert R.CLOUD.tag not in ("", R.NEXT.tag) and R.CLOUD.options("А, Б.") is None
    assert R.local(R.CLOUD) is R.DEFAULT and R.local(R.NEXT) is R.NEXT


def test_reshape_gets_classic_whatever_the_environment_asks(monkeypatch):
    monkeypatch.setenv("ASISTENT_RECOGNITION", 'next:{"second": "none", "level": -20}')
    assert R.for_preset("reshape") is R.CLASSIC
    other = R.for_preset("auto")
    assert (other.name, other.second, other.level) == ("next", "none", -20)


def test_every_other_style_gets_the_default_and_a_bad_request_changes_nothing(monkeypatch):
    monkeypatch.delenv("ASISTENT_RECOGNITION", raising=False)
    for preset in ("auto", "short", "standard", "gstroy", "credissimo", "ekopak", "beautysector", "aula"):
        assert R.for_preset(preset) is R.DEFAULT
    for asked in ("classic", "nonsense"):                      # ReShape's profile cannot be asked for by another style
        monkeypatch.setenv("ASISTENT_RECOGNITION", asked)
        assert R.for_preset("auto") is R.DEFAULT
    for asked in ('next:{"second": "maybe"}', 'next:{"repair": "guess"}', "next:{not json", 'next:{"no_such_field": 1}'):
        monkeypatch.setenv("ASISTENT_RECOGNITION", asked)
        assert R.for_preset("auto") is R.NEXT
    monkeypatch.setenv("ASISTENT_RECOGNITION", "strict")       # the way back, for one run
    assert R.for_preset("auto") is R.STRICT


def test_the_cache_key_of_a_reading_is_the_one_asistent_has_always_used():
    """Computed with the 0.10.118 code (git e3f0f46): a ReShape reading recognised before is still found, and none is redone."""
    y = np.arange(8, dtype=np.float32) / 8
    assert subtitle_job._words_key(y, "А, Б.") == "0247cd7dd98d566291c9fc3cd17ab3e85e1fc462"
    assert subtitle_job._words_key(y, "") == "3cc6a3740e38dd475b37aa72e88cd80c579dd438"
    for prof in (R.CLASSIC, R.STRICT):
        assert subtitle_job._words_key(y, "А, Б.", prof.tag) == "0247cd7dd98d566291c9fc3cd17ab3e85e1fc462"


def test_a_profile_that_hears_or_decodes_differently_never_shares_a_reading():
    y = np.arange(8, dtype=np.float32) / 8
    change = lambda **kw: dataclasses.replace(R.STRICT, **kw)
    profiles = (R.CLASSIC, change(level=-20.0), change(level=-23.0), change(highpass=80.0), change(hotwords=True), change(full=True),
                change(decode=(("condition_on_previous_text", False),)))
    assert len({subtitle_job._words_key(y, "", p.tag) for p in profiles}) == len(profiles)
    # what is done with the words afterwards does not change what was heard: those profiles share the reading
    assert change(second="none", repair="ear", part=30.0).tag == ""


def test_the_names_reach_whisper_as_hotwords_only_when_the_profile_says_so():
    hot = dataclasses.replace(R.STRICT, hotwords=True, decode=(("condition_on_previous_text", False),))
    assert hot.options("Мерцедес.") == {"condition_on_previous_text": False, "hotwords": "Мерцедес."}
    assert hot.options("") == {"condition_on_previous_text": False}
    assert R.NEXT.options("Мерцедес.") is None


# ---------------------------------------------------------------- the sound Whisper is given

def test_no_level_and_no_filter_is_the_same_sound_untouched():
    y = synth.talker(2, 3).astype(np.float32)
    for prof in (R.CLASSIC, R.STRICT, R.NEXT):
        assert R.prepare(y, prof) is y


def test_a_quiet_and_a_loud_recording_of_the_same_speech_reach_whisper_at_the_same_level():
    y = synth.talker(3, 3).astype(np.float32)
    prof = dataclasses.replace(R.NEXT, level=-20.0)
    quiet, normal = R.prepare((y * 0.03).astype(np.float32), prof), R.prepare((y * 0.6).astype(np.float32), prof)
    level = lambda z: 20 * np.log10(np.percentile(np.sqrt(np.mean(z[:len(z) // 320 * 320].reshape(-1, 320) ** 2, axis=1)), 90))
    assert abs(level(quiet) - (-20.0)) < 1.0 and quiet.dtype == np.float32
    assert abs(level(quiet) - level(normal)) < 0.1                            # 26 dB apart as recorded, the same when heard
    peaky = (y * 0.03).astype(np.float32)
    peaky[1000] = 0.9                                                         # one click far above the voice
    heard = R.prepare(peaky, prof)
    assert float(np.max(np.abs(heard))) < 0.991                               # never past full scale: the click is cut off there
    assert abs(level(heard) - level(quiet)) < 0.1                             # and it does not keep the quiet voice quiet


def test_silence_stays_silence_and_the_gain_has_limits():
    prof = dataclasses.replace(R.NEXT, level=-20.0, highpass=80.0)
    assert not R.prepare(np.zeros(16000, dtype=np.float32), prof).any()
    hiss = (synth.talker(2, 5) * 1e-4).astype(np.float32)                       # almost nothing: raised 40 dB at most
    assert float(np.max(np.abs(R.prepare(hiss, prof)))) <= float(np.max(np.abs(hiss))) * 100.0 * 1.2


# ---------------------------------------------------------------- the job

def test_a_reshape_run_hears_the_sound_as_recorded_and_calls_whisper_as_before(home, monkeypatch):
    calls = []

    def fake(audio, prompt, progress, cancelled, **k):
        calls.append((np.array(audio), prompt, k))
        return [dict(w) for w in WORDS]
    monkeypatch.setattr(asr, "transcribe", fake)
    b = body(home, preset="reshape", terms=["Мерцедес"])
    subtitle_job.run(b, *RUN)
    monkeypatch.setenv("ASISTENT_RECOGNITION", 'next:{"level": -20, "highpass": 80, "hotwords": true, "full": false, "decode": {"condition_on_previous_text": false}}')
    fresh_cache(home, monkeypatch, "app2")
    subtitle_job.run(b, *RUN)
    subtitle_job.run({**b, "preset": "auto"}, *RUN)
    (a0, p0, k0), (a1, p1, k1), (a2, p2, k2) = calls
    assert k0 == k1 == {} and p0 == p1 == "Мерцедес." and np.array_equal(a0, a1)       # ReShape: nothing reached it
    assert k2 == {"options": {"condition_on_previous_text": False, "hotwords": "Мерцедес."}}
    assert a2.shape == a0.shape and not np.array_equal(a2, a0)                            # the other style did get it


def test_a_reshape_result_keeps_exactly_the_keys_it_has(home, monkeypatch):
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [dict(w) for w in WORDS])
    monkeypatch.setenv("ASISTENT_RECOGNITION", "next")
    data = saved(subtitle_job.run(body(home, preset="reshape"), *RUN))
    assert set(data) == RESULT_KEYS and set(data["edits"]) == EDIT_KEYS


def test_the_fuller_log_is_written_only_by_a_profile_that_asks_for_it(home, monkeypatch):
    monkeypatch.setattr(asr, "transcribe", lambda *a, **k: [dict(w) for w in WORDS])
    monkeypatch.setenv("ASISTENT_RECOGNITION", "strict")
    data = saved(subtitle_job.run(body(home), *RUN))                       # the profile shipped before: its result as it was
    assert set(data) == RESULT_KEYS and set(data["edits"]) == EDIT_KEYS
    monkeypatch.setenv("ASISTENT_RECOGNITION", 'next:{"second": "none", "full": false}')
    data = saved(subtitle_job.run(body(home), *RUN))                       # a profile that logs
    assert set(data) == RESULT_KEYS | {"profile"} and data["profile"] == "next"
    assert set(data["edits"]) == EDIT_KEYS | {"swapped_pieces", "seam_duplicates"}


def doubtful(monkeypatch):
    """A piece whose first reading holds a word the dictionary does not know; the piece read alone gives a clean line."""
    known = {"това", "е", "одяло"}
    monkeypatch.setattr(subtitle_job.lexicon, "known", lambda w: True if norm(w) in known else (False if norm(w) else None))
    monkeypatch.setattr(subtitle_job.lexicon, "repair", lambda w, doubt=True, prefer=frozenset(), strict=True, **k: None)
    monkeypatch.setattr(subtitle_job.lexicon, "repair_by_ear", lambda w, doubt=True, prefer=frozenset(): None)
    monkeypatch.setattr(asr, "score_texts", lambda audio, texts, language="bg", counts=False: [(-5.0, 5)] * len(texts))   # the sound does not decide
    calls = []

    def fake(audio, prompt, progress, cancelled, **k):
        calls.append(k.get("beam"))
        if k.get("beam"):                                      # the piece alone: it starts 2 s into what is read
            return [{"word": "това", "start": 2.5, "end": 2.9, "p": 0.9}, {"word": "одяло", "start": 3.0, "end": 3.6, "p": 0.9}]
        return [{"word": "това", "start": 4.5, "end": 4.9, "p": 0.9}, {"word": "е", "start": 4.95, "end": 5.0, "p": 0.9},
                {"word": "одял,", "start": 5.05, "end": 5.6, "p": 0.45}]
    monkeypatch.setattr(asr, "transcribe", fake)
    return calls


def text(res):
    return " ".join(c["text"].replace("\n", " ") for c in res["captions"])


def test_strict_still_reads_a_doubtful_piece_three_times(home, monkeypatch):
    calls = doubtful(monkeypatch)
    monkeypatch.setenv("ASISTENT_RECOGNITION", "strict")
    res = subtitle_job.run(body(home), *RUN)
    assert sorted(c or 0 for c in calls) == [0, 0, subtitle_job.SECOND_BEAM]            # the window, the window louder, the piece alone
    assert "одяло" in text(res) and res["readings"]["second_opinions"] == [(3.0, "B")]   # fewer doubts wins when the sound does not


def test_no_second_reading_means_every_window_once_and_what_whisper_wrote(home, monkeypatch):
    calls = doubtful(monkeypatch)
    monkeypatch.setenv("ASISTENT_RECOGNITION", 'next:{"second": "none"}')
    res = subtitle_job.run(body(home), *RUN)
    assert calls == [None] and res["readings"]["second_opinions"] == []
    assert "одял" in text(res) and "одяло" not in text(res)
    assert saved(res)["edits"]["swapped_pieces"] == []


def test_sound_only_takes_another_reading_for_its_sound_never_for_its_dictionary_words(home, monkeypatch):
    doubtful(monkeypatch)
    monkeypatch.setenv("ASISTENT_RECOGNITION", 'next:{"second": "sound_only", "full": false}')
    res = subtitle_job.run(body(home), *RUN)
    assert "одяло" not in text(res) and res["readings"]["second_opinions"] == [(3.0, "A")]
    fresh_cache(home, monkeypatch, "app2")
    monkeypatch.setattr(asr, "score_texts", lambda audio, texts, language="bg", counts=False: [(-12.0, 5), (-2.0, 5), (-12.0, 5)][:len(texts)])
    res = subtitle_job.run(body(home), *RUN)                                 # now the sound clearly says the second reading
    assert "одяло" in text(res) and res["readings"]["second_opinions"] == [(3.0, "B")]
    assert saved(res)["edits"]["swapped_pieces"] == [{"at": 3.0, "pick": "B", "from": "това е одял,", "to": "това одяло"}]


def test_a_piece_read_alone_never_wins_with_fewer_words(home, monkeypatch):
    """Measured 2026-11-20: without this rule the second readings broke 33 words and fixed 27, most of the broken ones left out."""
    calls = doubtful(monkeypatch)
    monkeypatch.setattr(asr, "score_texts", lambda audio, texts, language="bg", counts=False, **k: [(-12.0, 5), (-2.0, 5)][:len(texts)])
    monkeypatch.setenv("ASISTENT_RECOGNITION", 'next:{"second": "alone", "full": false}')
    res = subtitle_job.run(body(home), *RUN)
    assert sorted(c or 0 for c in calls) == [0, subtitle_job.SECOND_BEAM]              # the window and the piece alone: no louder reading
    assert "одяло" not in text(res) and res["readings"]["second_opinions"] == [(3.0, "A")]   # „това одяло“ is a word short


def test_a_full_precision_profile_asks_for_that_model_and_reshape_never_does(home, monkeypatch):
    monkeypatch.setenv("ASISTENT_RECOGNITION", 'next:{"second": "none"}')
    kinds = []
    monkeypatch.setattr(asr, "transcribe", lambda audio, prompt, progress, cancelled, **k: kinds.append(k.get("model")) or [dict(w) for w in WORDS])
    monkeypatch.setattr(asr, "full_precision", lambda: asr.LARGE_FULL)
    subtitle_job.run(body(home, preset="reshape"), *RUN)
    subtitle_job.run(body(home), *RUN)                   # a full-precision profile
    assert kinds == [None, asr.LARGE_FULL]               # the same sound read twice: a full-precision reading has its own key
    monkeypatch.setattr(asr, "full_precision", lambda: asr.LARGE)          # a computer with little memory: the 8-bit model
    fresh_cache(home, monkeypatch, "app2")
    subtitle_job.run(body(home), *RUN)
    assert kinds[-1] is None


def test_the_full_precision_model_is_the_same_files_read_in_float32_on_the_processor(monkeypatch):
    made = []

    class Model:
        def __init__(self, path, **kw):
            made.append((path, kw["device"], kw["compute_type"]))
    import faster_whisper
    monkeypatch.setattr(faster_whisper, "WhisperModel", Model)
    monkeypatch.setattr(asr, "backend_installed", lambda: True)
    monkeypatch.setattr(asr, "model_present", lambda kind=asr.LARGE: True)
    monkeypatch.setattr(asr, "_device", lambda: ("cpu", "int8"))
    for kind in (asr.LARGE, asr.LARGE_FULL):
        monkeypatch.setitem(asr._states[kind], "model", None)
        asr._load(kind)
    assert made == [(asr.model_dir(), "cpu", "int8"), (asr.model_dir(), "cpu", "float32")]
    monkeypatch.setattr(asr, "_device", lambda: ("cuda", "float16"))          # a graphics card reads in float16 either way
    monkeypatch.setitem(asr._states[asr.LARGE_FULL], "model", None)
    asr._load(asr.LARGE_FULL)
    assert made[-1][1:] == ("cuda", "float16")
    for kind in (asr.LARGE, asr.LARGE_FULL):
        monkeypatch.setitem(asr._states[kind], "model", None)


# ---------------------------------------------------------------- the dictionary repair

def test_a_careful_repair_by_any_letter_needs_the_recording_to_say_the_word(monkeypatch):
    monkeypatch.setattr(lexicon, "_candidates", lambda word, doubt, strict=True: ("", ",", False, ((3, ["инкубация"]),)))
    assert lexicon.repair("интубация,", True) == "инкубация,"                               # as shipped
    assert lexicon.repair("интубация,", True, careful=True) is None                         # a neighbour is not a by-ear spelling
    assert lexicon.repair("интубация,", True, frozenset({"инкубация"}), careful=True) == "инкубация,"   # the speaker says it elsewhere


def test_a_careful_repair_leaves_the_by_ear_steps_as_they_are(monkeypatch):
    for step in (0, 1, 2):
        monkeypatch.setattr(lexicon, "_candidates", lambda word, doubt, strict=True, n=step: ("", "", True, ((n, ["неща"]),)))
        assert lexicon.repair("Нища", True, careful=True) == lexicon.repair("Нища", True) == "Неща"
    monkeypatch.setattr(lexicon, "_candidates", lambda word, doubt, strict=True: ("", "", False, ((4, ["одеялце"]),)))
    assert lexicon.repair("одялоце", True, careful=True) is None and lexicon.repair("одялоце", True) == "одеялце"


# ---------------------------------------------------------------- the call to Whisper

def test_transcribe_passes_a_profiles_options_and_nothing_new_without_them(monkeypatch):
    seen = []

    class Model:
        def transcribe(self, audio, **kw):
            seen.append(kw)
            return iter(()), None
    monkeypatch.setattr(asr, "_load", lambda *a: Model())
    monkeypatch.setattr(asr, "_schedule_free", lambda *a: None)
    y = np.zeros(1600, dtype=np.float32)
    asr.transcribe(y)
    asr.transcribe(y, options=None)
    asr.transcribe(y, "А.", options={"hotwords": "А.", "condition_on_previous_text": False})
    before = {"language": "bg", "word_timestamps": True, "vad_filter": False, "beam_size": 5, "initial_prompt": None}
    assert seen[0] == seen[1] == before
    assert seen[2] == {**before, "initial_prompt": "А.", "hotwords": "А.", "condition_on_previous_text": False}
