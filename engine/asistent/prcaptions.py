"""Caption lines as they are in a saved Premiere project (0.10.150, the user's reminder: "when I change the subtitles from
the Premiere Text tab it needs to update them in our Asistent automatically, so when I export the transcript it's accurate").

No script can read a caption's text (UXP `CaptionTrack` has times only, ExtendScript nothing; still so in the published
types of 27.1). The saved `.prproj` has it: a gzipped XML where every line on a caption track is a
`CaptionDataClipTrackItem` (Start / End in ticks, sequence time) with its OWN text `Block`, separate from the imported SRT,
so an edit made in the Text panel is there after a save. A `Block`'s `FormattedTextData` is base64 of a 12-byte header
(size, 0, magic 0x11223344) and a FlatBuffer; identical texts are stored once and later blocks carry only the
`BinaryHash`. In the FlatBuffer, root field 0 is the caption table and its field 0 the text runs, each run a table whose
field 0 is the run's text ("\\r" is a line break; a styled word is its own run). Measured on 1194 caption texts in four
projects on this Mac (2026-11-23, Premiere 26.5.3): one layout, no exception.

Read only: the file is opened for reading and never written. Chain: Sequence (ObjectUID = the sequence guid UXP and
ExtendScript report) -> TrackGroups -> DataTrackGroup -> CaptionDataClipTrack (ObjectUID) -> TrackItems ->
CaptionDataClipTrackItem -> Block.
"""
from __future__ import annotations

import base64
import gzip
import struct
import xml.etree.ElementTree as ET

TICKS = 254016000000
MAGIC = 0x11223344
WANTED = {"Sequence", "DataTrackGroup", "CaptionDataClipTrack", "CaptionDataClipTrackItem", "Block"}


def _u32(b: bytes, o: int) -> int:
    return struct.unpack_from("<I", b, o)[0]


def _fields(b: bytes, table: int) -> dict[int, int]:
    """field index -> absolute position of the field in a FlatBuffer table"""
    vt = table - struct.unpack_from("<i", b, table)[0]
    size = struct.unpack_from("<H", b, vt)[0]
    out = {}
    for f in range((size - 4) // 2):
        at = struct.unpack_from("<H", b, vt + 4 + 2 * f)[0]
        if at:
            out[f] = table + at
    return out


def _ref(b: bytes, at: int) -> int:
    return at + _u32(b, at)


def _string(b: bytes, at: int) -> str:
    n = _u32(b, at)
    if at + 4 + n > len(b):
        raise ValueError("string past the end")
    return b[at + 4:at + 4 + n].decode("utf-8")


def text_of(data: bytes) -> str:
    """The caption's text from a FormattedTextData buffer, lines joined with "\\n". ValueError when it is not one."""
    if len(data) < 16 or _u32(data, 8) != MAGIC:
        raise ValueError("not a caption text")
    b = data[12:]
    try:
        caption = _ref(b, _fields(b, _ref(b, 0))[0])
        runs = _ref(b, _fields(b, caption)[0])
        parts = []
        for k in range(_u32(b, runs)):
            run = _ref(b, runs + 4 + 4 * k)
            parts.append(_string(b, _ref(b, _fields(b, run)[0])))
    except (KeyError, struct.error, UnicodeDecodeError) as e:
        raise ValueError(f"unexpected caption text layout ({type(e).__name__})") from e
    text = "".join(parts).replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.strip() for line in text.split("\n")).strip()


def _refs(el: ET.Element, path: str, attr: str) -> list[str]:
    rows = [(int(x.get("Index") or 0), x.get(attr)) for x in el.findall(path)]
    return [r for _, r in sorted(rows) if r]


def read(path: str) -> list[dict]:
    """Every sequence that has caption lines:
    [{"guid", "name", "tracks": [{"index", "lines": [{"start", "end", "text"}]}]}] (seconds, lines in time order).
    A line whose text cannot be read has "text": None."""
    seqs: dict[str, dict] = {}
    groups: dict[str, list[str]] = {}
    tracks: dict[str, list[str]] = {}
    items: dict[str, dict] = {}
    blocks: dict[str, tuple[str | None, bytes | None]] = {}
    data: dict[str, bytes] = {}
    with gzip.open(path, "rb") as f:
        depth = 0
        root = None
        for event, el in ET.iterparse(f, events=("start", "end")):
            if event == "start":
                if root is None:
                    root = el
                depth += 1
                continue
            depth -= 1
            if depth != 1:
                continue
            tag = el.tag
            if tag in WANTED:
                if tag == "Sequence" and el.get("ObjectUID"):
                    seqs[el.get("ObjectUID")] = {"name": el.findtext("Name") or "",
                                                 "groups": [x.get("ObjectRef") for x in el.findall("TrackGroups/TrackGroup/Second")]}
                elif tag == "DataTrackGroup":
                    groups[el.get("ObjectID")] = _refs(el, "TrackGroup/Tracks/Track", "ObjectURef")
                elif tag == "CaptionDataClipTrack":
                    tracks[el.get("ObjectUID")] = _refs(el, "DataClipTrack/ClipTrack/ClipItems/TrackItems/TrackItem", "ObjectRef")
                elif tag == "CaptionDataClipTrackItem":
                    ti = el.find("DataClipTrackItem/ClipTrackItem/TrackItem")
                    bv = _refs(el, "BlockVector/BlockVectorItem", "ObjectRef")
                    if ti is not None:
                        items[el.get("ObjectID")] = {"start": int(ti.findtext("Start") or 0), "end": int(ti.findtext("End") or 0),
                                                     "blocks": bv}
                elif tag == "Block":
                    ftd = el.find("FormattedTextData")
                    if ftd is not None:
                        h = ftd.get("BinaryHash")
                        raw = (ftd.text or "").strip()
                        payload = base64.b64decode(raw) if raw else None
                        if payload is not None and h:
                            data.setdefault(h, payload)
                        blocks[el.get("ObjectID")] = (h, payload)
            root.clear()                                     # keep only what was taken out above (projects run to 100 MB)

    def line_text(block_ids: list[str]) -> str | None:
        texts = []
        for bid in block_ids:
            h, payload = blocks.get(bid, (None, None))
            payload = payload if payload is not None else data.get(h or "")
            if payload is None:
                return None
            try:
                texts.append(text_of(payload))
            except ValueError:
                return None
        return "\n".join(t for t in texts if t)

    out = []
    for guid, s in seqs.items():
        found = []
        for g in s["groups"]:
            for i, uid in enumerate(groups.get(g, [])):
                lines = []
                for ref in tracks.get(uid, []):
                    it = items.get(ref)
                    if it:
                        lines.append({"start": it["start"] / TICKS, "end": it["end"] / TICKS, "text": line_text(it["blocks"])})
                lines.sort(key=lambda x: (x["start"], x["end"]))
                found.append({"index": i, "lines": lines})
        if any(t["lines"] for t in found):
            out.append({"guid": guid, "name": s["name"], "tracks": found})
    return out
