"""Caption lines from a saved Premiere project (0.10.150) and the transcript that follows the editor's edits in Premiere."""
import base64
import gzip
import json
import struct
from pathlib import Path

import pytest

from asistent import prcaptions as PC
from asistent import transcript as T

# A real caption text from the test project NEW TEST.prproj (Premiere 26.5.3): one run, "тестов ред 1".
REAL = ("zAEAAAAAAABEMyIRDAAAAAAABgAKAAQABgAAAGQAAAAAAF4ATAAUABAAAAAAAEgARAAAAAAAAAAAAEAAPwA4AAAANAAwACwAKAAAACQAIAAAAAAAAAAA"
        "AAAAAAAAAAAAAAAAAAAAGAAAAAAAAAAAAAAADwAAAAgAAAAAAB8ABwBeAAAAAAAAAUQAAAAAAAABgAAAAJAAAAA8AAAAAAAAAAAAIEEAAAAAWAAAAAAA"
        "QEEAAMBAAABAQAAAyEIAAAABSAAAAAIAAAACAAAAGP///xz///8BAAAADAAAAAAABgAIAAQABgAAAAQAAAANAAAAQW5pbWF0aW9uVHlwZQAAAF7///8A"
        "AAAAZv///wAAAAABAAAABAAAAAYAAABNb25hY28AAAEAAAAMAAAACAAOAAQACAAIAAAAhAAAADwAAAAAADYAHAAAABgAAAAAABQAAAAQAAAAAAAAAAAA"
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAACAAEADYAAAACAAAAFAAAABgAAAAAAAAAIAAAAAAAQELg////BAAGAAQAAAAAAAoACAAFAAYABwAKAAAAAAAA"
        "AAQABAAEAAAAFQAAANGC0LXRgdGC0L7QsiDRgNC10LQgMQAAAA==")
TICKS = 254016000000


def fb_text(runs):
    """The same layout as Premiere's: header, root -> caption table -> vector of run tables -> strings."""
    b = bytearray(4)
    vt = len(b)
    b += struct.pack("<HHH", 6, 8, 4) + b"\0\0"

    def table():
        pos = len(b)
        b.extend(struct.pack("<iI", pos - vt, 0))
        return pos

    root, cap = table(), table()
    struct.pack_into("<I", b, 0, root)
    struct.pack_into("<I", b, root + 4, cap - (root + 4))
    vec = len(b)
    b += struct.pack("<I", len(runs)) + b"\0\0\0\0" * len(runs)
    struct.pack_into("<I", b, cap + 4, vec - (cap + 4))
    for k, text in enumerate(runs):
        t = table()
        struct.pack_into("<I", b, vec + 4 + 4 * k, t - (vec + 4 + 4 * k))
        s = len(b)
        enc = text.encode("utf-8")
        b += struct.pack("<I", len(enc)) + enc + b"\0"
        while len(b) % 4:
            b.append(0)
        struct.pack_into("<I", b, t + 4, s - (t + 4))
    return struct.pack("<III", len(b), 0, 0x11223344) + bytes(b)


def prproj(path, sequences):
    """A minimal gzipped .prproj: sequences = [(guid, name, [[(start, end, runs or hash-only text), ...] per track])]."""
    parts, oid = [], [100]

    def nid():
        oid[0] += 1
        return str(oid[0])

    for guid, name, tracks in sequences:
        group = nid()
        uids = []
        for ti, lines in enumerate(tracks):
            uid = f"{guid}-t{ti}"
            uids.append(uid)
            refs = []
            for start, end, runs in lines:
                item, block = nid(), nid()
                refs.append(item)
                parts.append(f'<CaptionDataClipTrackItem ObjectID="{item}"><DataClipTrackItem><ClipTrackItem><TrackItem>'
                             f'<Start>{round(start * TICKS)}</Start><End>{round(end * TICKS)}</End></TrackItem></ClipTrackItem>'
                             f'</DataClipTrackItem><BlockVector><BlockVectorItem Index="0" ObjectRef="{block}"/></BlockVector>'
                             f'</CaptionDataClipTrackItem>')
                data = fb_text(runs)
                h = f"h{abs(hash(tuple(runs)))}"
                # Premiere writes a text's data once; every later block with the same text carries only its hash
                body = "" if any(f'BinaryHash="{h}">' in p for p in parts) else base64.b64encode(data).decode()
                parts.append(f'<Block ObjectID="{block}"><FormattedTextData Encoding="base64" BinaryHash="{h}"'
                             + (f">{body}</FormattedTextData>" if body else "/>") + "</Block>")
            items = "".join(f'<TrackItem Index="{i}" ObjectRef="{r}"/>' for i, r in enumerate(refs))
            parts.append(f'<CaptionDataClipTrack ObjectUID="{uid}"><DataClipTrack><ClipTrack><ClipItems><TrackItems>{items}'
                         f'</TrackItems></ClipItems></ClipTrack></DataClipTrack></CaptionDataClipTrack>')
        tracks_xml = "".join(f'<Track Index="{i}" ObjectURef="{u}"/>' for i, u in enumerate(uids))
        parts.append(f'<DataTrackGroup ObjectID="{group}"><TrackGroup><Tracks>{tracks_xml}</Tracks></TrackGroup></DataTrackGroup>')
        parts.insert(0, f'<Sequence ObjectUID="{guid}"><TrackGroups><TrackGroup Index="0"><First>x</First>'
                        f'<Second ObjectRef="{group}"/></TrackGroup></TrackGroups><Name>{name}</Name></Sequence>')
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n<PremiereData Version="3">' + "".join(parts) + "</PremiereData>"
    with gzip.open(path, "wb") as f:
        f.write(xml.encode("utf-8"))
    return str(path)


def _w(text, t, d=0.3, gap=0.05):
    out = []
    for tok in text.split():
        out.append({"word": tok, "start": round(t, 3), "end": round(t + d, 3)})
        t += d + gap
    return out


def test_a_real_caption_text_and_runs_with_line_breaks():
    assert PC.text_of(base64.b64decode(REAL)) == "тестов ред 1"
    assert PC.text_of(fb_text(["ПОЛУЧАВАТЕ ЗА\r", "ОСЕМ ЕВРО"])) == "ПОЛУЧАВАТЕ ЗА\nОСЕМ ЕВРО"
    with pytest.raises(ValueError):
        PC.text_of(b"\0" * 40)


def test_the_project_gives_each_sequence_its_caption_lines_in_time_order(tmp_path):
    p = prproj(tmp_path / "a.prproj", [
        ("g-1", "Video 1", [[(2.0, 3.0, ["второ"]), (1.0, 2.0, ["първо"]), (3.0, 4.0, ["първо"])]]),
        ("g-2", "Video 2", [[]]),                                    # no lines: not listed
    ])
    seqs = PC.read(p)
    assert [s["guid"] for s in seqs] == ["g-1"]
    lines = seqs[0]["tracks"][0]["lines"]
    assert [(l["start"], l["text"]) for l in lines] == [(1.0, "първо"), (2.0, "второ"), (3.0, "първо")]   # the 3rd: hash only


def _run(tmp_path, text="Днес ще ви покажа нещо ново. Това е Алфа.", caps=False):
    words = _w(text, 10.0)
    half = len(words) // 2
    caps_of = (lambda s: s.upper()) if caps else (lambda s: s)
    captions = [{"start": words[0]["start"], "end": words[half - 1]["end"], "text": caps_of(" ".join(w["word"] for w in words[:half]))},
                {"start": words[half]["start"], "end": words[-1]["end"], "text": caps_of(" ".join(w["word"] for w in words[half:]))}]
    folder = tmp_path / "Asistent_subtitles"
    folder.mkdir(exist_ok=True)
    js = folder / "Video 1 2026-11-23.json"
    js.write_text(json.dumps({"words": words, "captions": captions}, ensure_ascii=False), encoding="utf-8")
    return js, captions


def test_an_untouched_track_gives_exactly_the_runs_transcript(tmp_path):
    js, caps = _run(tmp_path, caps=True)
    lines = [(c["start"], c["end"], [c["text"].replace(" ", " ")]) for c in caps]
    p = prproj(tmp_path / "v.prproj", [("g-1", "Video 1", [lines])])
    before = Path(T.export(str(js))["path"]).read_text(encoding="utf-8")
    r = T.export(str(js), project=p, guid="g-1")
    assert Path(r["path"]).read_text(encoding="utf-8") == before
    assert r["premiere"] == {"lines": 2, "changed": 0}


def test_words_changed_in_premiere_are_in_the_transcript(tmp_path):
    js, caps = _run(tmp_path, caps=True)
    # the editor fixed „нещо“ -> „НЕЩО ДРУГО“ and „Алфа“ -> „АЛФА СПОРТ“ in Premiere's Text panel (a capitals style)
    lines = [(caps[0]["start"], caps[0]["end"], ["ДНЕС ЩЕ ВИ\r", "ПОКАЖА НЕЩО ДРУГО"]),
             (caps[1]["start"], caps[1]["end"], ["НОВО. ТОВА Е АЛФА СПОРТ"])]
    p = prproj(tmp_path / "v.prproj", [("g-1", "Video 1", [lines])])
    r = T.export(str(js), project=p, guid="g-1")
    text = Path(r["path"]).read_text(encoding="utf-8")
    assert text.startswith("Днес ще ви покажа нещо друго ново. Това е Алфа спорт.")   # run's case and punctuation kept
    assert r["premiere"] == {"lines": 2, "changed": 2}


def test_a_deleted_word_and_a_moved_line(tmp_path):
    js, caps = _run(tmp_path)
    # „ново“ deleted; the second line moved 5 s later on the timeline
    lines = [(caps[0]["start"], caps[0]["end"], ["Днес ще ви покажа нещо"]),
             (caps[1]["start"] + 5, caps[1]["end"] + 5, ["Това е Алфа."])]
    p = prproj(tmp_path / "v.prproj", [("g-1", "Video 1", [lines])])
    words, changed = T.edited_words(T._words(json.loads(js.read_text(encoding="utf-8"))), PC.read(p)[0]["tracks"][0]["lines"])
    assert " ".join(w["word"] for w in words) == "Днес ще ви покажа нещо Това е Алфа."
    assert words[-1]["start"] >= caps[1]["start"] + 5 - 0.01                    # timed where the line is now
    assert changed == 1


def test_the_track_is_found_by_its_times_and_the_sequence_by_guid_or_name(tmp_path):
    js, caps = _run(tmp_path)
    other = [(100.0, 101.0, ["друго"])]
    mine = [(c["start"], c["end"], [c["text"]]) for c in caps]
    p = prproj(tmp_path / "v.prproj", [("g-1", "Video 1", [other, mine])])
    run = json.loads(js.read_text(encoding="utf-8"))
    lines, why = T.premiere_lines(run, p, "g-1", None)
    assert why == "" and len(lines) == 2
    assert T.premiere_lines(run, p, "missing", "Video 1")[0] is not None       # the name when the guid is not there
    assert T.premiere_lines(run, p, "missing", "Other")[1] == "the saved project has no captions on this sequence"
    p2 = prproj(tmp_path / "w.prproj", [("g-1", "Video 1", [other])])
    assert "not found" in T.premiere_lines(run, p2, "g-1", None)[1]
    r = T.export(str(js), project=p2, guid="g-1")                                # falls back to the run, says why
    assert r["premiere"]["lines"] == 0 and "not found" in r["premiere"]["why"]
    assert T.premiere_lines(run, str(tmp_path / "none.prproj"), "g-1", None) == (None, "the project file was not found")
