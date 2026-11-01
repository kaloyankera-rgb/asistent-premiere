"""Deterministic speech-like test material (no text-to-speech, no real client audio).

A "talker" is a glottal pulse train with a wandering pitch, shaped by formant resonators that change
every syllable, with natural pauses. Two talkers make a scene; each "microphone" hears the scene through
its own gain, colouring filter, noise and clock.
"""
from __future__ import annotations

import subprocess

import numpy as np
from scipy import signal
from scipy.io import wavfile

SCENE_SR = 48000


def talker(seconds: float, seed: int, f0: float = 140.0, sr: int = SCENE_SR) -> np.ndarray:
    rng = np.random.default_rng(seed)
    out = np.zeros(int(seconds * sr), np.float64)
    t = 0.2
    while t < seconds - 0.5:
        words = rng.integers(2, 7)
        for _ in range(words):
            syl = rng.uniform(0.08, 0.25)
            n = int(syl * sr)
            pitch = f0 * np.exp(rng.normal(0, 0.12)) * (1 + 0.1 * np.sin(np.linspace(0, rng.uniform(1, 4), n)))
            phase = np.cumsum(pitch / sr)
            pulses = (np.diff(np.floor(phase), prepend=0) > 0).astype(np.float64)
            src = pulses + 0.05 * rng.standard_normal(n)
            if rng.random() < 0.25:                      # unvoiced consonant
                src = rng.standard_normal(n) * 0.3
            y = np.zeros(n)
            for fc, bw in ((rng.uniform(300, 900), 90), (rng.uniform(900, 2400), 120), (rng.uniform(2400, 3500), 200)):
                b, a = signal.iirpeak(fc, fc / bw, fs=sr)
                y += signal.lfilter(b, a, src)
            env = np.sin(np.linspace(0, np.pi, n)) ** 0.7
            i = int(t * sr)
            seg = (y * env)[: max(0, len(out) - i)]
            out[i:i + len(seg)] += seg
            t += syl + rng.uniform(0.0, 0.06)
        t += rng.uniform(0.15, 0.9)
    return out / (np.max(np.abs(out)) + 1e-12) * 0.5


def scene(seconds: float, seed: int = 1) -> tuple[np.ndarray, np.ndarray]:
    """Two talkers that take turns (with some overlap)."""
    s1 = talker(seconds, seed, 120.0)
    s2 = talker(seconds, seed + 100, 210.0)
    gate = (np.sin(2 * np.pi * np.arange(len(s1)) / SCENE_SR / 9.0) > -0.2).astype(float)
    gate = signal.lfilter([0.001], [1, -0.999], gate)
    return s1 * gate, s2 * (1.2 - gate)


def mic(sources: list[tuple[np.ndarray, float]], start: float, seconds: float, *, sr: int = 48000,
        noise_db: float = -70.0, color: tuple[float, float] | None = None, gain_db: float = 0.0,
        drift_ppm: float = 0.0, seed: int = 7) -> np.ndarray:
    """Record the scene from `start` (scene seconds) for `seconds`, at `sr`, through this mic."""
    rng = np.random.default_rng(seed)
    mix = sum(src * g for src, g in sources)
    if color:
        b, a = signal.butter(2, list(color), btype="band", fs=SCENE_SR)
        mix = signal.lfilter(b, a, mix)
    # sample the scene on this device's clock: device second = (1 + drift) scene seconds
    n = int(seconds * sr)
    t_scene = start + np.arange(n) / sr * (1 + drift_ppm * 1e-6)
    x = np.interp(t_scene * SCENE_SR, np.arange(len(mix)), mix, left=0.0, right=0.0)
    x = x * 10 ** (gain_db / 20)
    x += rng.standard_normal(n) * 10 ** (noise_db / 20)
    return x.astype(np.float32)


def write_wav(path, channels: list[np.ndarray], sr: int = 48000, bits16: bool = False):
    n = min(len(c) for c in channels)
    data = np.stack([c[:n] for c in channels], axis=1)
    if bits16:
        data = np.clip(data * 32767, -32768, 32767).astype(np.int16)
    wavfile.write(str(path), sr, data if data.shape[1] > 1 else data[:, 0])
    return str(path)


def write_mp4(path, wav: str, fps: str = "30", audio_delay: float = 0.0, vfr: bool = False):
    """Wrap a WAV into an H.264/AAC MP4 with a test picture; optional audio start delay / VFR."""
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                                "default=nk=1:nw=1", wav], capture_output=True, text=True).stdout)
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size=320x240:rate={fps}:duration={dur}"]
    if audio_delay:
        cmd += ["-itsoffset", str(audio_delay)]
    cmd += ["-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast",
            "-c:a", "aac", "-b:a", "192k"]
    if vfr:
        cmd += ["-vf", "select='lt(t,2)+not(mod(n,5))'", "-fps_mode", "vfr"]
    cmd += [str(path)]
    subprocess.run(cmd, check=True)
    return str(path)
