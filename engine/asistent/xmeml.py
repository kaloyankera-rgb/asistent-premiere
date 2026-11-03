"""Final Cut Pro 7 XML (xmeml v4) for a rough cut (Phase 8): the pieces of edl.py as ONE new sequence.

Ported from tools/autoedit/export.py (whose four Premiere import bugs were fixed and confirmed by the user on
2026-10-24; Asistent is an independent repo, so the code is copied, as asr.py was). What the import is known to do in
Premiere 26.0.2 (M0 probe, docs/ROUGHCUT_PLAN.md): UXP `project.importFiles` makes the sequence without a dialog, frame
exact, the video and audio of a piece linked, markers from `<marker>` included, new master clips only in the first
import of a file.

Differences from autoedit: any number of tracks with any pieces (autoedit assumed one speaker per clip number), video
and audio pieces of the same media range are linked by their range, not by their index, and the markers are optional.
Every audio track of the source sequence becomes a stereo track here, written as its two exploded channels (as
Premiere's own export does).
"""
from __future__ import annotations

import os
import re
import urllib.parse
from xml.sax.saxutils import escape

from . import media


def _rate(fps: float) -> str:
    tb = int(round(fps))
    return "<rate><timebase>%d</timebase><ntsc>%s</ntsc></rate>" % (tb, "TRUE" if abs(fps - tb) > 0.01 else "FALSE")


def pathurl(path: str) -> str:
    p = os.path.abspath(path).replace("\\", "/")
    if re.match(r"^[A-Za-z]:", p):
        return "file://localhost/" + p[0] + "%3a" + urllib.parse.quote(p[2:])
    return "file://localhost" + urllib.parse.quote(p)


def _level(gain_db: float) -> str:
    """Audio Levels as autoedit writes it (linear, 1 = 0 dB), proven on real work. The panel reads the level back from the
    new sequence and sets it again through Premiere's own Volume if the import did not take it."""
    return ('<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory>'
            '<effecttype>audiolevels</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid>'
            '<name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>%.5f</value></parameter></effect></filter>'
            % min(3.98109, 10 ** (gain_db / 20)))


def write(path: str, name: str, fps: float, width: int, height: int, pieces: list[dict], markers: list[dict] | None = None,
          probe=None) -> dict:
    """pieces: edl.pieces(); markers: [{"frame", "name", "comment"}] in output frames. -> {"frames", "video", "audio"}
    where video/audio count the pieces per track (the panel checks the sequence it gets against them)."""
    probe = probe or media.probe
    rate = _rate(fps)
    info_cache: dict[str, object] = {}
    fid: dict[str, str] = {}

    def info(src):
        if src not in info_cache:
            info_cache[src] = probe(src)
        return info_cache[src]

    def file_xml(src):
        if src in fid:
            return '<file id="%s"/>' % fid[src]
        fid[src] = "file-%d" % (len(fid) + 1)
        m = info(src)
        dur = int(m.duration * fps)
        video = ""
        if m.has_video:
            # a file stored sideways with a rotation flag (3840x2160, rotation 90) is described as it DISPLAYS (2160x3840): the
            # sequence the user sees upright is made of such files, and the stored size made them come in sideways
            w, h = (m.height, m.width) if getattr(m, "rotation", 0) in (90, 270) else (m.width, m.height)
            video = ('<video><samplecharacteristics>%s<width>%d</width><height>%d</height></samplecharacteristics></video>'
                     % (rate, w, h))
        audio = ""
        if m.audio:
            audio = ('<audio><samplecharacteristics><depth>16</depth><samplerate>%d</samplerate></samplecharacteristics>'
                     '<channelcount>%d</channelcount></audio>' % (m.audio[0].sample_rate, m.audio[0].channels))
        return ('<file id="%s"><name>%s</name><pathurl>%s</pathurl>%s<duration>%d</duration><media>%s%s</media></file>'
                % (fid[src], escape(os.path.basename(src)), pathurl(src), rate, dur, video, audio))

    video: dict[int, list[dict]] = {}
    audio: dict[int, list[dict]] = {}
    for p in sorted(pieces, key=lambda p: (p["start"], p["item"])):
        (video if p["kind"] == "video" else audio).setdefault(p["track"], []).append(dict(p))
    for tracks in (video, audio):
        for lst in tracks.values():
            for n, p in enumerate(lst, 1):
                p["n"] = n

    # a video piece and the audio pieces of the same media range are one linked clip
    groups: dict[tuple, list[tuple]] = {}
    for t, lst in video.items():
        for p in lst:
            p["id"] = "v%d-%d" % (t + 1, p["n"])
            groups.setdefault((p["path"], p["src_in"], p["src_out"], p["start"], p["end"]), []).append(("video", t + 1, p["n"], p["id"], False))
    for t, lst in audio.items():
        for p in lst:
            for side in (1, 2):
                phys = 2 * t + side
                groups.setdefault((p["path"], p["src_in"], p["src_out"], p["start"], p["end"]), []).append(
                    ("audio", phys, p["n"], "a%d-%d" % (phys, p["n"]), True))

    def links(p, my_id):
        members = groups.get((p["path"], p["src_in"], p["src_out"], p["start"], p["end"]), [])
        if len(members) < 2:
            return ""
        return "".join('<link><linkclipref>%s</linkclipref><mediatype>%s</mediatype><trackindex>%d</trackindex>'
                       '<clipindex>%d</clipindex>%s</link>' % (ref, kind, ti, ci, "<groupindex>1</groupindex>" if grp else "")
                       for kind, ti, ci, ref, grp in members)

    def clipitem(cid, p, extra, premiere_stereo=False):
        f = file_xml(p["path"])
        tag = '<clipitem premiereChannelType="stereo" id="%s">' if premiere_stereo else '<clipitem id="%s">'
        return (tag % cid + '<name>%s</name><duration>%d</duration>%s<start>%d</start><end>%d</end><in>%d</in><out>%d</out>%s%s</clipitem>'
                % (escape(os.path.basename(p["path"])), int(info(p["path"]).duration * fps), rate, p["start"], p["end"],
                   p["src_in"], p["src_out"], f, extra))

    track_end = "<enabled>TRUE</enabled><locked>FALSE</locked>"
    v_xml, a_xml = [], []
    for t in range(max(video) + 1 if video else 0):
        v_xml.append("<track>%s%s</track>" % ("".join(clipitem(p["id"], p, links(p, p["id"])) for p in video.get(t, [])), track_end))
    for t in range(max(audio) + 1 if audio else 0):
        for side in (1, 2):
            phys = 2 * t + side
            items = []
            for p in audio.get(t, []):
                chans = info(p["path"]).audio[0].channels if info(p["path"]).audio else 1
                # an Asistent split clip (L/L upper, R/R lower) reads ONE source channel on both sides: that is what Modify Clip >
                # Audio Channels does; otherwise side 1 reads channel 1 and side 2 channel 2
                src_track = min(p["channel"], chans) if p.get("channel") else min(side, max(1, chans))
                extra = ('<sourcetrack><mediatype>audio</mediatype><trackindex>%d</trackindex></sourcetrack>' % src_track
                         + (_level(p["gain_db"]) if p.get("gain_db") is not None else "") + links(p, "a%d-%d" % (phys, p["n"])))
                items.append(clipitem("a%d-%d" % (phys, p["n"]), p, extra, True))
            a_xml.append('<track currentExplodedTrackIndex="%d" totalExplodedTrackCount="2" premiereTrackType="Stereo">%s%s'
                         '<outputchannelindex>%d</outputchannelindex></track>' % (side - 1, "".join(items), track_end, side))
    outputs = "".join('<group><index>%d</index><numchannels>1</numchannels><downmix>0</downmix><channel><index>%d</index></channel></group>'
                      % (k, k) for k in (1, 2))
    total = max([p["end"] for p in pieces] or [0])
    mk = "".join("<marker><comment>%s</comment><name>%s</name><in>%d</in><out>-1</out></marker>"
                 % (escape(m.get("comment", "")), escape(m.get("name", "")), m["frame"]) for m in (markers or []))
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence id="sequence-1">'
           '<name>%s</name><duration>%d</duration>%s%s<timecode>%s<string>00:00:00:00</string><frame>0</frame>'
           '<displayformat>NDF</displayformat></timecode><media><video><format><samplecharacteristics>%s<width>%d</width>'
           '<height>%d</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>%s</video>'
           '<audio><numOutputChannels>2</numOutputChannels><format><samplecharacteristics><depth>16</depth>'
           '<samplerate>48000</samplerate></samplecharacteristics></format><outputs>%s</outputs>%s</audio></media></sequence></xmeml>\n'
           % (escape(name), total, rate, mk, rate, rate, width, height, "".join(v_xml), outputs, "".join(a_xml)))
    with open(path, "w", encoding="utf-8") as f:
        f.write(xml)
    return {"frames": total, "video": {t + 1: len(v) for t, v in video.items()}, "audio": {t + 1: len(v) for t, v in audio.items()}}
