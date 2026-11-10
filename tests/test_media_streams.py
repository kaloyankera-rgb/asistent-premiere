"""A file whose second audio track FFmpeg cannot decode (an iPhone's Apple spatial audio, APAC: field report 2026-11-10,
IMG_0357.MOV) is read from the track that can be decoded; a file with only such a track gets a plain answer (0.10.25)."""
import numpy as np
import pytest

from asistent import media
from asistent.media import AudioStream, MediaError, MediaInfo


def _info(*streams):
    return MediaInfo(path="/x/IMG_0357.MOV", duration=1.0, has_video=True, audio=list(streams))


def _reader(bad):
    def read(path, stream, channels, sr, cancelled=None, expected=None):
        if stream in bad:
            raise MediaError("FFmpeg cannot decode the sound of IMG_0357.MOV: Decoding requested, but no decoder found "
                             "for: apple_apac")
        t = np.arange(sr, dtype=np.float32) / sr
        return np.stack([np.sin(2 * np.pi * (220 + 110 * c) * t) * 0.1 for c in range(channels)]).astype(np.float32)
    return read


def test_the_apac_track_is_left_out_and_the_aac_track_used(monkeypatch):
    monkeypatch.setattr(media, "read_audio", _reader({1}))
    out = media.load_channels(_info(AudioStream(0, 2, 48000, 0.0), AudioStream(1, 4, 48000, 0.0)), 8000)
    assert [c.label for c in out] == ["A1 L", "A1 R"]


def test_only_apac_says_so_plainly(monkeypatch):
    monkeypatch.setattr(media, "read_audio", _reader({0}))
    with pytest.raises(MediaError, match="only Apple's spatial audio"):
        media.load_channels(_info(AudioStream(0, 4, 48000, 0.0)), 8000)


def test_another_decoding_error_is_passed_on_unchanged(monkeypatch):
    def broken(*a, **k):
        raise MediaError("FFmpeg cannot decode the sound of a.mp4: Invalid data found")
    monkeypatch.setattr(media, "read_audio", broken)
    with pytest.raises(MediaError, match="Invalid data found"):
        media.load_channels(_info(AudioStream(0, 2, 48000, 0.0)), 8000)


def test_files_that_decode_are_read_as_before(monkeypatch):
    monkeypatch.setattr(media, "read_audio", _reader(set()))
    out = media.load_channels(_info(AudioStream(0, 2, 48000, 0.0), AudioStream(1, 1, 48000, 0.0)), 8000)
    assert [c.label for c in out] == ["A1 L", "A1 R", "A2"]
