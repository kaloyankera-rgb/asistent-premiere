"""FFprobe/FFmpeg wrappers: stream inspection and per-channel PCM extraction.

Source files are only ever read. Nothing here writes next to the media.
"""
from __future__ import annotations

import copy
import json
import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from fractions import Fraction

import numpy as np

log = logging.getLogger("asistent")


class MediaError(Exception):
    """A file could not be probed or decoded; the message is shown to the editor."""


def _tool(name: str) -> str:
    """Locate ffmpeg/ffprobe: env override, PATH, then the usual install folders."""
    env = os.environ.get(f"ASISTENT_{name.upper()}")
    if env and os.path.isfile(env):
        return env
    found = shutil.which(name)
    if found:
        return found
    exe = name + (".exe" if sys.platform == "win32" else "")
    for folder in ("/opt/homebrew/bin", "/usr/local/bin", r"C:\ffmpeg\bin",
                   os.path.expandvars(r"%LOCALAPPDATA%\Asistent\ffmpeg\bin")):
        cand = os.path.join(folder, exe)
        if os.path.isfile(cand):
            return cand
    raise MediaError(f"{name} was not found. Install FFmpeg (see README).")


PROBE_TIMEOUT = 120.0          # ffprobe on a file that never answers (a dead network drive) gives up after this
DECODE_TIMEOUT = 1800.0        # a decode that hangs this long is stopped (a two-hour file decodes in well under a minute)


class Interrupted(Exception):
    """The subprocess was stopped because the job was cancelled (sync.Cancelled is raised by the caller)."""


def _run(cmd: list[str], timeout: float | None = None, cancelled=None) -> subprocess.CompletedProcess:
    """Run FFmpeg/FFprobe and collect its output. 0.10.6 (BUG-014): stops the process when `cancelled()` turns true or after
    `timeout` seconds (default: PROBE_TIMEOUT for ffprobe, DECODE_TIMEOUT otherwise), instead of waiting for ever."""
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    if timeout is None:
        timeout = PROBE_TIMEOUT if "ffprobe" in os.path.basename(cmd[0]).lower() else DECODE_TIMEOUT
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, creationflags=flags)
    deadline = time.monotonic() + timeout
    while True:
        try:
            out, err = p.communicate(timeout=0.25)       # output is kept across the retries (subprocess docs)
            return subprocess.CompletedProcess(cmd, p.returncode, out, err)
        except subprocess.TimeoutExpired:
            stop = "cancelled" if cancelled and cancelled() else "timeout" if time.monotonic() > deadline else None
            if stop:
                p.kill()
                p.communicate()
                if stop == "cancelled":
                    raise Interrupted()
                raise MediaError(f"{os.path.basename(cmd[0])} did not finish within {int(timeout)} s and was stopped.")


CHUNK_BYTES = 1 << 22           # 4 MB of FFmpeg output at a time


def decode_f32(cmd: list[str], channels: int, expected: int, cancelled=None, timeout: float | None = None) -> np.ndarray:
    """Run an FFmpeg command that writes interleaved float32 to stdout -> (channels, samples), C-contiguous.

    0.10.6 (PERF-001): the output is read in 4 MB chunks straight into its place in the result, so the decode is held once;
    before, stdout (one full copy) and the de-interleaved copy coexisted (twice the size: ~2.8 GB for an hour of 48 kHz
    stereo). The samples are exactly the same. `expected`: samples per channel (a little over is best; the array grows if
    FFmpeg gives more). Stops on `cancelled()` (Interrupted) or after `timeout` seconds (MediaError), like `_run`; a failed
    FFmpeg raises MediaError with its message."""
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    timeout = DECODE_TIMEOUT if timeout is None else timeout
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, creationflags=flags)
    err: list[bytes] = []
    t = threading.Thread(target=lambda: err.append(p.stderr.read()), daemon=True)      # stderr never fills its pipe
    t.start()
    cap = max(1, int(expected))
    flat = np.empty(channels * cap, dtype=np.float32)           # row c lives at flat[c*cap : c*cap + n]
    frame = 4 * channels
    chunk = bytearray(CHUNK_BYTES - CHUNK_BYTES % frame)
    view = memoryview(chunk)
    filled = 0
    n = 0
    deadline = time.monotonic() + timeout
    try:
        while True:
            if cancelled and cancelled():
                raise Interrupted()
            if time.monotonic() > deadline:
                raise MediaError(f"{os.path.basename(cmd[0])} did not finish within {int(timeout)} s and was stopped.")
            got = p.stdout.readinto(view[filled:])
            if got:
                filled += got
            whole = filled - filled % frame
            if whole:
                block = np.frombuffer(chunk, dtype=np.float32, count=whole // 4).reshape(-1, channels)
                k = block.shape[0]
                if n + k > cap:                                       # FFmpeg gave more than expected: grow (rare)
                    new_cap = max(cap * 3 // 2, n + k)
                    grown = np.empty(channels * new_cap, dtype=np.float32)
                    for c in range(channels):
                        grown[c * new_cap:c * new_cap + n] = flat[c * cap:c * cap + n]
                    flat, cap = grown, new_cap
                for c in range(channels):
                    flat[c * cap + n:c * cap + n + k] = block[:, c]
                n += k
                rest = filled - whole
                view[:rest] = view[whole:filled]
                filled = rest
            if not got:
                break
        p.wait(timeout=max(1.0, deadline - time.monotonic()))
    except BaseException:
        p.kill()
        p.wait()
        raise
    finally:
        t.join(timeout=5)
        for pipe in (p.stdout, p.stderr):
            try:
                pipe.close()
            except OSError:
                pass
    if p.returncode != 0:
        raise MediaError((b"".join(err)).decode(errors="replace").strip()[:200] or f"exit code {p.returncode}")
    # rows to the front (row c from c*cap to c*n; c*n <= c*cap, so nothing unread is overwritten): one contiguous array
    for c in range(1, channels):
        flat[c * n:(c + 1) * n] = flat[c * cap:c * cap + n].copy() if (c + 1) * n > c * cap else flat[c * cap:c * cap + n]
    return flat[:channels * n].reshape(channels, n)


def _rate(text: str | None) -> float | None:
    if not text or text in ("0/0", "0"):
        return None
    try:
        return float(Fraction(text))
    except (ValueError, ZeroDivisionError):
        return None


def _float(text) -> float | None:
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


@dataclass
class AudioStream:
    index: int            # position among audio streams (0 = first), as used by -map 0:a:N
    channels: int
    sample_rate: int
    start_time: float     # seconds, container clock
    layout: str = ""


@dataclass
class MediaInfo:
    path: str
    duration: float
    has_video: bool
    fps: float | None = None
    avg_fps: float | None = None
    vfr: bool = False
    video_start: float = 0.0
    width: int = 0
    height: int = 0
    rotation: int = 0                            # the display-matrix flag (90/270: phones and Sony store vertical video sideways)
    timecode: str | None = None
    audio: list[AudioStream] = field(default_factory=list)
    # when the recording started, in the camera's own clock (Unix seconds): the container's creation_time
    # (Sony writes the record start, equal to its XML sidecar), else the file's modification time minus the
    # duration (cameras close the file when they stop). Camera clocks are not set alike (GStroy: FX30 in
    # 2024, FX3 in 2026), so only differences within one camera mean anything until chrono.py corrects them.
    recorded: float | None = None
    recorded_from: str | None = None             # "metadata" | "file"

    @property
    def audio_lead(self) -> float:
        """Seconds the first audio sample comes after the first video frame (usually 0)."""
        if not self.audio or not self.has_video:
            return 0.0
        return self.audio[0].start_time - self.video_start

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        d["audio"] = [a.__dict__ for a in self.audio]
        d["audio_lead"] = self.audio_lead
        return d


# FFprobe answers the same for a file that did not change, and every button probes every selected file: the
# answers are kept for the engine's life by path, size and modification time (2026-11-03, speed).
_PROBED: dict = {}
_PROBE_LOCK = threading.Lock()


def probe(path: str) -> MediaInfo:
    if not os.path.isfile(path):
        raise MediaError(f"The file is missing: {path}")
    st = os.stat(path)
    key = (os.path.abspath(path), st.st_size, st.st_mtime_ns)
    with _PROBE_LOCK:
        hit = _PROBED.get(key)
    if hit is not None:
        return copy.deepcopy(hit)
    info = _probe_file(path)
    with _PROBE_LOCK:
        _PROBED[key] = copy.deepcopy(info)
    return info


def probe_all(paths) -> None:
    """Probes every distinct file side by side, so a job's later per-file probes are answered from the cache. A missing
    or unreadable file is left alone here: its own caller reports it."""
    from concurrent.futures import ThreadPoolExecutor

    def one(p):
        try:
            probe(p)
        except (MediaError, OSError):
            pass

    with ThreadPoolExecutor(max_workers=8, thread_name_prefix="probe") as pool:
        list(pool.map(one, list(dict.fromkeys(paths))))


def _probe_file(path: str) -> MediaInfo:
    p = _run([_tool("ffprobe"), "-v", "error", "-print_format", "json",
              "-show_format", "-show_streams", path])
    if p.returncode != 0:
        raise MediaError(f"FFprobe cannot read {os.path.basename(path)}: "
                         f"{p.stderr.decode(errors='replace').strip()[:200]}")
    data = json.loads(p.stdout or b"{}")
    fmt = data.get("format", {})
    streams = data.get("streams", [])
    info = MediaInfo(path=path, duration=_float(fmt.get("duration")) or 0.0, has_video=False)
    info.timecode = (fmt.get("tags") or {}).get("timecode")
    a_idx = 0
    for s in streams:
        kind = s.get("codec_type")
        tags = s.get("tags") or {}
        if kind == "video" and not info.has_video and s.get("disposition", {}).get("attached_pic", 0) == 0:
            info.has_video = True
            info.fps = _rate(s.get("r_frame_rate"))
            info.avg_fps = _rate(s.get("avg_frame_rate"))
            if info.fps and info.avg_fps:
                info.vfr = abs(info.fps - info.avg_fps) / info.fps > 0.002
            info.video_start = _float(s.get("start_time")) or 0.0
            info.width = int(s.get("width") or 0)
            info.height = int(s.get("height") or 0)
            for sd in s.get("side_data_list") or []:
                if sd.get("rotation") is not None:
                    info.rotation = int(round(float(sd["rotation"]))) % 360
            if tags.get("rotate"):
                info.rotation = int(round(float(tags["rotate"]))) % 360
            info.timecode = info.timecode or tags.get("timecode")
        elif kind == "audio":
            info.audio.append(AudioStream(
                index=a_idx,
                channels=int(s.get("channels") or 0),
                sample_rate=int(s.get("sample_rate") or 0),
                start_time=_float(s.get("start_time")) or 0.0,
                layout=s.get("channel_layout") or "",
            ))
            a_idx += 1
        elif kind == "data" and tags.get("timecode"):
            info.timecode = info.timecode or tags.get("timecode")
    if not info.duration:
        info.duration = max((_float(s.get("duration")) or 0.0) for s in streams) if streams else 0.0
    created = _when((fmt.get("tags") or {}).get("creation_time"))
    for s in streams:
        created = created or _when((s.get("tags") or {}).get("creation_time"))
    if created is not None:
        info.recorded, info.recorded_from = created, "metadata"
    else:
        try:
            info.recorded, info.recorded_from = os.path.getmtime(path) - info.duration, "file"
        except OSError:
            pass
    return info


def _when(text: str | None) -> float | None:
    """ISO creation_time -> Unix seconds; the zero dates of an unset clock (1904/1970) count as none."""
    if not text:
        return None
    try:
        t = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return t.timestamp() if t.year >= 1980 else None


def read_audio(path: str, stream: int, channels: int, sr: int, cancelled=None, expected: int | None = None) -> np.ndarray:
    """Decode one audio stream to float32 at `sr`, shape (channels, samples). No downmix."""
    cmd = [_tool("ffmpeg"), "-v", "error", "-nostdin", "-i", path, "-map", f"0:a:{stream}",
           "-af", "aresample=filter_size=64:cutoff=0.95", "-ar", str(sr), "-ac", str(channels), "-f", "f32le", "-"]
    if expected is None:
        try:
            expected = int((probe(path).duration or 0) * sr) + sr
        except MediaError:
            expected = sr * 60
    try:
        return decode_f32(cmd, channels, expected, cancelled)
    except Interrupted:
        raise
    except MediaError as e:
        raise MediaError(f"FFmpeg cannot decode the sound of {os.path.basename(path)}: {e}") from e


@dataclass
class Channel:
    label: str            # e.g. "A1 L", "A1 R", "A2"
    stream: int
    channel: int
    data: np.ndarray      # float32 mono at the analysis rate
    rms_db: float
    peak_db: float
    silent: bool = False
    duplicate_of: str | None = None


def _db(v: float) -> float:
    return 20.0 * np.log10(max(v, 1e-12))


def load_channels(info: MediaInfo, sr: int) -> list[Channel]:
    """Every channel of every audio stream as its own mono signal, with level stats.

    Silent channels and exact duplicates (dual-mono) are flagged so callers can skip them.
    """
    out: list[Channel] = []
    failed: list[tuple[AudioStream, MediaError]] = []
    for a in info.audio:
        if a.channels <= 0:
            continue
        try:
            x = read_audio(info.path, a.index, a.channels, sr)
        except MediaError as e:
            # an iPhone file carries a normal AAC track and Apple's spatial audio (APAC) beside it, which FFmpeg cannot
            # decode (field report 2026-11-10, IMG_0357.MOV): a track that cannot be read is left out when another can
            failed.append((a, e))
            continue
        for c in range(x.shape[0]):
            ch = x[c]
            side = ""
            if a.channels == 2:
                side = " L" if c == 0 else " R"
            elif a.channels > 2:
                side = f" ch{c + 1}"
            label = f"A{a.index + 1}{side}"
            rms = float(np.sqrt(np.mean(ch.astype(np.float64) ** 2))) if len(ch) else 0.0
            peak = float(np.max(np.abs(ch))) if len(ch) else 0.0
            # only digital silence counts as silent: a very quiet channel is still worth trying
            out.append(Channel(label, a.index, c, ch, _db(rms), _db(peak), silent=peak < 10 ** (-90 / 20)))
    if failed:
        name = os.path.basename(info.path)
        if not out:
            e = failed[0][1]
            if "apac" in str(e).lower():
                raise MediaError(f"{name} has only Apple's spatial audio (APAC), which FFmpeg cannot read. Export it from "
                                 "the iPhone or Photos as a normal video (or record with spatial audio off) and try again.") from e
            raise e
        log.info("audio: %s: track %s left out (%s), using the other track(s)", name,
                 ", ".join(f"A{a.index + 1}" for a, _ in failed), str(failed[0][1])[-120:])
    # dual-mono detection: a channel identical to an earlier one adds nothing
    for i, ci in enumerate(out):
        if ci.silent:
            continue
        for cj in out[:i]:
            if cj.silent or cj.duplicate_of or len(cj.data) != len(ci.data):
                continue
            n = min(len(ci.data), sr * 60)
            a, b = ci.data[:n].astype(np.float64), cj.data[:n].astype(np.float64)
            den = np.sqrt(np.dot(a, a) * np.dot(b, b))
            if den > 0 and np.dot(a, b) / den > 0.999:
                ci.duplicate_of = cj.label
                break
    return out
