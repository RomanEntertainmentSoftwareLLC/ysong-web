from __future__ import annotations

import json, math, re, subprocess, time, uuid
from pathlib import Path
from typing import Any

import numpy as np

EPS = 1e-12
AI_VENDOR_TERMS = {
    "suno": 30,
    "udio": 30,
    "lyria": 30,
    "musicgen": 26,
    "audiocraft": 24,
    "stable audio": 26,
    "stability ai": 24,
    "elevenlabs": 24,
    "minimax music": 24,
    "mureka": 24,
    "riffusion": 22,
}

# Aliases are matched as whole lexical phrases, never raw substrings.
# This is critical for short vendor names such as ``udio``: plain substring
# matching would falsely detect the word ``audio`` as Udio.
AI_VENDOR_ALIASES = {
    "suno": ("suno", "suno ai"),
    "udio": ("udio", "udio ai"),
    "lyria": ("lyria", "google lyria"),
    "musicgen": ("musicgen", "music gen"),
    "audiocraft": ("audiocraft", "audio craft"),
    "stable audio": ("stable audio",),
    "stability ai": ("stability ai",),
    "elevenlabs": ("elevenlabs", "eleven labs", "eleven labs inc"),
    "minimax music": ("minimax music", "minimax-music"),
    "mureka": ("mureka",),
    "riffusion": ("riffusion",),
}


def _contains_vendor(text: str, canonical: str) -> bool:
    """Return True only for a lexical vendor/brand mention, not a substring accident."""
    aliases = AI_VENDOR_ALIASES.get(canonical, (canonical,))
    for alias in aliases:
        # Alnum boundaries protect names embedded inside ordinary words: e.g.
        # 'audio' must never match the vendor 'udio'. Hyphens/spaces inside
        # aliases are preserved and regex-escaped.
        pattern = r"(?<![a-z0-9])" + re.escape(alias.lower()) + r"(?![a-z0-9])"
        if re.search(pattern, text.lower()):
            return True
    return False



def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def run_json(cmd: list[str]) -> dict[str, Any]:
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return json.loads(p.stdout.decode("utf-8", "replace"))


def probe_audio(path: Path) -> dict[str, Any]:
    data = run_json(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)])
    streams = [s for s in data.get("streams", []) if s.get("codec_type") == "audio"]
    if not streams:
        raise ValueError("No audio stream found in this file.")
    s = streams[0]
    f = data.get("format", {})
    duration = float(s.get("duration") or f.get("duration") or 0.0)
    return {
        "duration": duration,
        "sample_rate": int(float(s.get("sample_rate") or 0)),
        "channels": int(s.get("channels") or 0),
        "codec": s.get("codec_name") or "unknown",
        "bit_rate": int(float(s.get("bit_rate") or f.get("bit_rate") or 0)),
        "format": f.get("format_name") or "unknown",
        "tags": {**(f.get("tags") or {}), **(s.get("tags") or {})},
    }


def _synchsafe32(b: bytes) -> int:
    if len(b) != 4:
        return 0
    return ((b[0] & 0x7F) << 21) | ((b[1] & 0x7F) << 14) | ((b[2] & 0x7F) << 7) | (b[3] & 0x7F)


def _structured_regions(path: Path, probe: dict[str, Any]) -> bytes:
    """Return container metadata regions while deliberately excluding encoded audio payload.

    v0.1/v0.2 searched arbitrary compressed bytes for short strings such as ``jumb``.
    That can produce false positives by chance. This helper keeps provenance scanning inside
    real container/header regions for the common formats used by the preview.
    """
    try:
        raw = path.read_bytes()
    except OSError:
        return b""
    fmt = str(probe.get("format") or "").lower()
    regions: list[bytes] = []

    # MP3: provenance/ID3 payload belongs in the ID3v2 tag at the head of the file.
    if raw.startswith(b"ID3") and len(raw) >= 10:
        n = _synchsafe32(raw[6:10])
        end = min(len(raw), 10 + n + (10 if (raw[5] & 0x10) else 0))
        regions.append(raw[:end])

    # RIFF/WAVE: keep non-audio chunks and skip the PCM/encoded data chunk.
    if raw[:4] in (b"RIFF", b"RF64") and raw[8:12] == b"WAVE":
        pos = 12
        while pos + 8 <= len(raw):
            cid = raw[pos:pos+4]
            size = int.from_bytes(raw[pos+4:pos+8], "little", signed=False)
            body0 = pos + 8
            body1 = min(len(raw), body0 + size)
            if cid != b"data":
                regions.append(raw[pos:min(body1, pos + 2_000_000)])
            pos = body0 + size + (size & 1)
            if pos <= body0:
                break

    # FLAC: metadata blocks are before the audio frames.
    if raw.startswith(b"fLaC"):
        pos = 4
        while pos + 4 <= len(raw):
            head = raw[pos:pos+4]
            last = bool(head[0] & 0x80)
            size = int.from_bytes(head[1:4], "big")
            body1 = min(len(raw), pos + 4 + size)
            regions.append(raw[pos:min(body1, pos + 2_000_000)])
            pos = body1
            if last:
                break

    # AIFF/AIFC: skip SSND sample payload, retain other chunks.
    if raw.startswith(b"FORM") and raw[8:12] in (b"AIFF", b"AIFC"):
        pos = 12
        while pos + 8 <= len(raw):
            cid = raw[pos:pos+4]
            size = int.from_bytes(raw[pos+4:pos+8], "big", signed=False)
            body0 = pos + 8
            body1 = min(len(raw), body0 + size)
            if cid != b"SSND":
                regions.append(raw[pos:min(body1, pos + 2_000_000)])
            pos = body0 + size + (size & 1)
            if pos <= body0:
                break

    # MP4/M4A: retain top-level boxes except mdat, which contains compressed media payload.
    if any(x in fmt for x in ("mov", "mp4", "m4a", "3gp")) and len(raw) >= 8:
        pos = 0
        while pos + 8 <= len(raw):
            size = int.from_bytes(raw[pos:pos+4], "big", signed=False)
            typ = raw[pos+4:pos+8]
            header = 8
            if size == 1 and pos + 16 <= len(raw):
                size = int.from_bytes(raw[pos+8:pos+16], "big", signed=False)
                header = 16
            elif size == 0:
                size = len(raw) - pos
            if size < header or pos + size > len(raw):
                break
            if typ != b"mdat":
                regions.append(raw[pos:min(pos + size, pos + 3_000_000)])
            pos += size

    # For unknown containers, inspect only a small header region and require strong C2PA
    # vocabulary later; never scan megabytes of arbitrary compressed audio.
    if not regions:
        regions.append(raw[:min(len(raw), 262_144)])
    return b"".join(regions)


def _extract_printable(blob: bytes) -> str:
    # C2PA/JUMBF stores useful assertion names and JSON strings among binary CBOR/box data.
    # Preserve spacing so nearby tokens remain searchable without pretending to fully decode CBOR.
    out = []
    run = []
    for x in blob:
        if 32 <= x < 127:
            run.append(chr(x))
        else:
            if len(run) >= 4:
                out.append("".join(run))
            run = []
    if len(run) >= 4:
        out.append("".join(run))
    return " ".join(out)


def scan_container(path: Path, probe: dict[str, Any]) -> dict[str, Any]:
    tags = probe.get("tags") or {}
    tag_text = " ".join(f"{k}:{v}" for k, v in tags.items()).lower()
    tag_vendor_hits: list[str] = []
    vendor_weight = 0
    for term, weight in AI_VENDOR_TERMS.items():
        if _contains_vendor(tag_text, term):
            tag_vendor_hits.append(term)
            vendor_weight = max(vendor_weight, weight)

    structured = _structured_regions(path, probe)
    printable = _extract_printable(structured)
    low = printable.lower()

    manifest_vendor_hits: list[str] = []
    for term, weight in AI_VENDOR_TERMS.items():
        if _contains_vendor(low, term) and term not in tag_vendor_hits:
            manifest_vendor_hits.append(term)
            vendor_weight = max(vendor_weight, weight)

    # Require actual provenance vocabulary rather than a stray four-byte `jumb` sequence.
    has_c2pa = ("application/c2pa" in low or "c2pa manifest" in low or "urn:c2pa:" in low or "c2pa.claim" in low)
    has_jumbf = ("jumbf" in low or "jumd" in low or "jumb" in low)
    c2pa_markers: list[str] = []
    if has_c2pa:
        c2pa_markers.append("c2pa")
    if has_c2pa and has_jumbf:
        c2pa_markers.append("jumbf")

    compact_low = low.replace(" ", "")
    digital_source_types: list[str] = []
    if "compositewithtrainedalgorithmicmedia" in compact_low:
        digital_source_types.append("compositeWithTrainedAlgorithmicMedia")
    elif "trainedalgorithmicmedia" in compact_low:
        digital_source_types.append("trainedAlgorithmicMedia")
    elif "algorithmicmedia" in compact_low:
        digital_source_types.append("algorithmicMedia")
    generative_declaration = bool(digital_source_types)

    # Strongest local clue available to this preview: a structured C2PA/manifest region that
    # explicitly declares algorithmic media and/or names a known generator. This is provenance,
    # not a waveform guess. We still phrase the result as evidence rather than legal proof.
    explicit_ai_manifest = bool(has_c2pa and (generative_declaration or manifest_vendor_hits))

    # Pull a human-readable creator/claim-generator name when it is plainly visible.
    claim_generator = None
    claim_candidates = (
        ("Eleven Labs Inc.", "elevenlabs"),
        ("Suno", "suno"),
        ("Udio", "udio"),
        ("Lyria", "lyria"),
    )
    for display, canonical in claim_candidates:
        if _contains_vendor(low, canonical):
            claim_generator = display
            break
    if claim_generator is None and re.search(r"(?<![a-z0-9])google\s+deepmind(?![a-z0-9])", low):
        claim_generator = "Google DeepMind"

    return {
        "tags": tags,
        "vendor_hits": tag_vendor_hits,
        "manifest_vendor_hits": manifest_vendor_hits,
        "c2pa_markers": c2pa_markers,
        "digital_source_types": digital_source_types,
        "claim_generator": claim_generator,
        "explicit_ai_manifest": explicit_ai_manifest,
        "provenance_strength": vendor_weight,
    }


def analysis_profile(mode: str) -> dict[str, int | float]:
    # Fast is deliberately cheap. Deep is meaningfully deeper: 3x as many windows,
    # longer windows, native-CD-rate decode, and a larger FFT.
    if mode == "deep":
        return {"windows": 9, "segment_seconds": 20.0, "sample_rate": 44100, "fft_size": 4096, "hop": 1024}
    return {"windows": 3, "segment_seconds": 10.0, "sample_rate": 24000, "fft_size": 2048, "hop": 1024}


def choose_windows(duration: float, mode: str) -> list[tuple[float, float]]:
    p = analysis_profile(mode)
    seg = float(p["segment_seconds"])
    n = int(p["windows"])
    if duration <= 0:
        return [(0.0, seg)]
    if duration <= seg * 1.35:
        return [(0.0, duration)]

    # Cover intro, body and tail while avoiding only sampling exact endpoints/fades.
    starts = np.linspace(0.035, 0.94, n)
    out: list[tuple[float, float]] = []
    for f in starts:
        start = min(max(0.0, duration * float(f) - seg / 2), max(0.0, duration - seg))
        item = (float(start), min(seg, duration - start))
        if not out or abs(item[0] - out[-1][0]) > max(0.75, seg * 0.20):
            out.append(item)
    return out


def decode_segment(path: Path, start: float, dur: float, sr: int) -> np.ndarray:
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-t", f"{dur:.3f}", "-i", str(path),
        "-vn", "-ac", "2", "-ar", str(sr), "-f", "f32le", "pipe:1"
    ]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    arr = np.frombuffer(p.stdout, dtype=np.float32)
    if arr.size < 4:
        raise ValueError("Audio decode produced no samples.")
    arr = arr[: arr.size - (arr.size % 2)].reshape(-1, 2)
    return np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)


def frame_audio(x: np.ndarray, n: int, hop: int, max_frames: int = 1400) -> np.ndarray:
    if len(x) < n:
        x = np.pad(x, (0, n - len(x)))
    starts = np.arange(0, len(x) - n + 1, hop)
    if len(starts) > max_frames:
        starts = starts[np.linspace(0, len(starts)-1, max_frames).astype(int)]
    win = np.hanning(n).astype(np.float32)
    return np.stack([x[i:i+n] * win for i in starts], axis=0)


def moving_average(x: np.ndarray, width: int) -> np.ndarray:
    width = max(3, int(width) | 1)
    pad = width // 2
    xp = np.pad(x, (pad, pad), mode="edge")
    return np.convolve(xp, np.ones(width, dtype=np.float64) / width, mode="valid")


def peak_indices(v: np.ndarray, min_distance: int, threshold: float) -> np.ndarray:
    if len(v) < 3:
        return np.array([], dtype=int)
    candidates = np.where((v[1:-1] > v[:-2]) & (v[1:-1] >= v[2:]) & (v[1:-1] > threshold))[0] + 1
    if candidates.size == 0:
        return candidates
    order = candidates[np.argsort(v[candidates])[::-1]]
    keep: list[int] = []
    for idx in order:
        if all(abs(int(idx) - j) >= min_distance for j in keep):
            keep.append(int(idx))
    return np.array(sorted(keep), dtype=int)


def log_bin_spectrum(freqs: np.ndarray, power: np.ndarray, bins: int = 80) -> list[float]:
    """Smooth log-frequency visual without the empty-low-bin spikes v0.1 produced."""
    hi = min(float(freqs[-1]), 20000.0)
    centers = np.geomspace(45.0, max(90.0, hi), bins)
    p = np.interp(centers, freqs, power, left=power[0], right=power[-1])
    db = 10 * np.log10(p + EPS)
    # A tiny smoothing pass preserves character but removes FFT-bin combing from the graph.
    db = moving_average(db, 5)
    db -= np.max(db)
    db = np.clip(db, -72, 0)
    return [round(float(v), 2) for v in db]


def energy_curve(x: np.ndarray, sr: int, points: int = 140) -> list[float]:
    if len(x) == 0:
        return []
    n = max(1, len(x) // points)
    vals = []
    for i in range(0, len(x), n):
        seg = x[i:i+n]
        if len(seg) == 0:
            continue
        rms = math.sqrt(float(np.mean(seg * seg)) + EPS)
        vals.append(20 * math.log10(rms + EPS))
    if len(vals) > points:
        vals = vals[:points]
    return [round(max(-90.0, min(0.0, v)), 2) for v in vals]



def _moving_minimum(x: np.ndarray, width: int = 10) -> np.ndarray:
    """Small dependency-free minimum filter used by the vocoder-comb lens."""
    width = max(3, int(width))
    left = width // 2
    right = width - 1 - left
    xp = np.pad(x, (left, right), mode="edge")
    views = np.stack([xp[i:i+len(x)] for i in range(width)], axis=0)
    return np.min(views, axis=0)


def decode_fakeprint_audio(path: Path, max_seconds: float = 180.0) -> np.ndarray:
    """Decode a lightweight mono 16 kHz stream for the architecture-fingerprint lens.

    This is deliberately independent from the higher-rate musical-feature windows. 16 kHz and
    a large FFT make a long average spectrum cheap to compute while retaining the 1-8 kHz band
    where neural-vocoder reconstruction combs are often easiest to see.
    """
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-vn", "-t", f"{max_seconds:.3f}", "-ac", "1", "-ar", "16000",
        "-f", "f32le", "pipe:1",
    ]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    arr = np.frombuffer(p.stdout, dtype=np.float32)
    if arr.size < 8192:
        raise ValueError("Audio is too short for spectral fingerprint analysis.")
    return np.nan_to_num(arr.astype(np.float64), nan=0.0, posinf=0.0, neginf=0.0)


def vocoder_comb_features(audio: np.ndarray) -> dict[str, Any]:
    """Measure persistent narrow spectral-comb residue without requiring a trained model.

    The method intentionally does *not* classify by genre, BPM or loudness. It averages a long
    spectrum, removes a local lower envelope, then measures whether the remaining narrow peaks
    repeat with a stable frequency spacing. Such combs can be produced by neural decoder /
    upsampling architectures, but they are evidence rather than proof and can evolve between
    generator versions.
    """
    sr = 16000
    n_fft = 8192
    hop = n_fft // 2
    y = np.pad(audio, (n_fft // 2, n_fft // 2), mode="reflect")
    win = np.hanning(n_fft).astype(np.float64)
    spectra: list[np.ndarray] = []
    max_frames = 720  # comfortably covers 180 s at this hop while bounding work
    starts = np.arange(0, max(1, len(y) - n_fft + 1), hop)
    if len(starts) > max_frames:
        starts = starts[np.linspace(0, len(starts)-1, max_frames).astype(int)]
    for i in starts:
        frame = y[int(i):int(i)+n_fft]
        if len(frame) < n_fft:
            frame = np.pad(frame, (0, n_fft-len(frame)))
        power = np.abs(np.fft.rfft(frame * win)) ** 2
        spectra.append(10.0 * np.log10(np.clip(power, 1e-10, 1e6)))
    mean_db = np.mean(np.stack(spectra, axis=0), axis=0)
    freqs = np.linspace(0.0, sr / 2.0, len(mean_db))
    mask = (freqs >= 1000.0) & (freqs <= 8000.0)
    band = mean_db[mask]
    hull = np.clip(_moving_minimum(band, 10), -45.0, None)
    residue = np.clip(band - hull, 0.0, 5.0)
    residue /= float(np.max(residue) + 1e-6)

    centered = residue - float(np.mean(residue))
    ac = np.correlate(centered, centered, mode="full")[len(centered)-1:]
    ac /= float(ac[0] + EPS)

    # Search a broad family of comb spacings. Each candidate must reproduce at least three
    # harmonically-related autocorrelation peaks; local +/-2-bin tolerance handles drift.
    profile: list[float] = []
    for base in range(25, 170):
        vals: list[float] = []
        for k in range(1, 501 // base + 1):
            idx = base * k
            lo, hi = max(1, idx - 2), min(len(ac), idx + 3)
            if hi <= lo:
                continue
            vals.append(max(0.0, float(np.max(ac[lo:hi]))))
        if len(vals) < 3:
            profile.append(0.0)
            continue
        first = np.array(vals[:min(4, len(vals))], dtype=float)
        # Reward both strength and persistence across several harmonics.
        score = 0.65 * float(np.mean(first)) + 0.35 * float(np.quantile(first, 0.25))
        profile.append(score)

    prof = np.array(profile, dtype=float)
    best_i = int(np.argmax(prof))
    best_base = best_i + 25
    best_strength = float(prof[best_i])
    median_strength = float(np.median(prof) + 1e-9)
    peak_ratio = best_strength / median_strength
    spacing_hz = best_base * (sr / n_fft)

    # Downsample residue for UI/report visibility. Unlike an ordinary average spectrum this view
    # highlights narrow reconstruction peaks rather than the song's broad tonal balance.
    target = 180
    xp = np.linspace(0, len(residue) - 1, target)
    viz = np.interp(xp, np.arange(len(residue)), residue)

    abs_support = clamp((best_strength - 0.10) / 0.16)
    ratio_support = clamp((peak_ratio - 2.0) / 2.5)
    support = math.sqrt(abs_support * ratio_support)

    return {
        "vocoder_comb_support": float(support),
        "vocoder_comb_strength": best_strength,
        "vocoder_comb_peak_ratio": float(peak_ratio),
        "vocoder_comb_spacing_hz": float(spacing_hz),
        "vocoder_comb_base_bins": int(best_base),
        "fakeprint": [round(float(v), 4) for v in viz],
    }


def segment_features(stereo: np.ndarray, sr: int, fft_size: int, hop: int) -> dict[str, Any]:
    L = stereo[:, 0].astype(np.float64)
    R = stereo[:, 1].astype(np.float64)
    mono = 0.5 * (L + R)
    peak = float(np.max(np.abs(mono)) + EPS)
    rms = math.sqrt(float(np.mean(mono * mono)) + EPS)
    crest_db = 20 * math.log10(peak / max(rms, EPS))

    frames = frame_audio(mono.astype(np.float32), n=fft_size, hop=hop)
    spec = np.abs(np.fft.rfft(frames, axis=1)).astype(np.float64) + EPS
    power = spec * spec
    freqs = np.fft.rfftfreq(frames.shape[1], 1 / sr)
    mean_power = np.mean(power, axis=0)

    frame_sum = np.sum(spec, axis=1) + EPS
    centroid = np.sum(spec * freqs[None, :], axis=1) / frame_sum
    flatness = np.exp(np.mean(np.log(spec), axis=1)) / (np.mean(spec, axis=1) + EPS)

    hf_mask = freqs >= min(12000.0, sr * 0.38)
    hf_ratio = np.sum(power[:, hf_mask], axis=1) / (np.sum(power, axis=1) + EPS) if np.any(hf_mask) else np.zeros(len(frames))
    hf_mean = float(np.mean(hf_ratio))
    hf_cv = float(np.std(hf_ratio) / (hf_mean + 1e-9)) if hf_mean > 1e-8 else 10.0

    # Spectral flux / onset timing.
    norm = spec / (np.linalg.norm(spec, axis=1, keepdims=True) + EPS)
    flux = np.zeros(len(norm))
    if len(norm) > 1:
        d = norm[1:] - norm[:-1]
        flux[1:] = np.sqrt(np.sum(np.maximum(d, 0) ** 2, axis=1))
    med = float(np.median(flux)); mad = float(np.median(np.abs(flux - med)) + EPS)
    peaks = peak_indices(flux, min_distance=max(1, int(0.075 * sr / hop)), threshold=med + 2.4 * mad)
    onset_times = peaks * hop / sr
    if len(onset_times) >= 6:
        iois = np.diff(onset_times)
        iois = iois[(iois > 0.055) & (iois < 2.5)]
    else:
        iois = np.array([])
    if len(iois) >= 4:
        ioi_cv = float(np.std(iois) / (np.mean(iois) + EPS))
        base = float(np.median(iois))
        sub = max(0.055, base / 2)
        phase = np.mod(onset_times, sub)
        residual = np.minimum(phase, sub - phase)
        quant_resid = float(np.median(residual) / sub)
        grid_precision = clamp(1.0 - quant_resid / 0.22)
    else:
        ioi_cv = 0.65
        grid_precision = 0.45

    # Dynamics by half-second blocks.
    block = max(1, int(sr * 0.5))
    rms_db, crest_blocks = [], []
    for i in range(0, len(mono), block):
        s = mono[i:i+block]
        if len(s) < block // 4:
            continue
        r = math.sqrt(float(np.mean(s*s)) + EPS)
        p = float(np.max(np.abs(s)) + EPS)
        rms_db.append(20 * math.log10(r + EPS))
        crest_blocks.append(20 * math.log10(p / max(r, EPS)))
    if len(rms_db) >= 4:
        dynamic_spread = float(np.percentile(rms_db, 90) - np.percentile(rms_db, 10))
        crest_std = float(np.std(crest_blocks))
        macro_loudness_std = float(np.std(rms_db))
    else:
        dynamic_spread, crest_std, macro_loudness_std = 7.0, 2.5, 3.0

    # Stereo / phase behavior in one-second blocks.
    block2 = max(1, sr)
    cors, widths = [], []
    for i in range(0, len(L), block2):
        l = L[i:i+block2]; r = R[i:i+block2]
        if len(l) < block2 // 4:
            continue
        den = math.sqrt(float(np.sum(l*l) * np.sum(r*r))) + EPS
        cors.append(float(np.sum(l*r) / den))
        mid = 0.5*(l+r); side = 0.5*(l-r)
        widths.append(math.sqrt(float(np.mean(side*side)) + EPS) / (math.sqrt(float(np.mean(mid*mid)) + EPS) + EPS))
    corr_mean = float(np.mean(cors)) if cors else 1.0
    corr_std = float(np.std(cors)) if cors else 0.0
    width_mean = float(np.mean(widths)) if widths else 0.0
    width_cv = float(np.std(widths) / (width_mean + 1e-6)) if widths and width_mean > 1e-5 else 1.0

    # Cross-time spectral stationarity. This is descriptive only; mastering/loops can mimic it.
    if len(norm) > 8:
        stride = max(1, int(1.0 * sr / hop))
        sims = [float(np.dot(norm[i], norm[i+stride])) for i in range(0, len(norm)-stride, stride)]
        spectral_stationarity = float(np.mean(sims)) if sims else 0.5
        spectral_stationarity_std = float(np.std(sims)) if sims else 0.25
    else:
        spectral_stationarity, spectral_stationarity_std = 0.5, 0.25

    # Spectral texture + entropy variation. Low entropy variation plus highly stationary spectra
    # is modest support only; it cannot independently classify a track.
    logp = 10*np.log10(mean_power + EPS)
    smooth = moving_average(logp, 41)
    resid = logp - smooth
    texture = np.abs(np.fft.rfft(resid - np.mean(resid)))
    texture_ratio = float(np.max(texture[2:]) / (np.median(texture[2:]) + EPS)) if len(texture) > 6 else 1.0
    prob = power / (np.sum(power, axis=1, keepdims=True) + EPS)
    entropy = -np.sum(prob * np.log(prob + EPS), axis=1) / math.log(prob.shape[1])
    entropy_std = float(np.std(entropy))

    return {
        "crest_db": crest_db,
        "centroid_hz": float(np.mean(centroid)),
        "flatness_mean": float(np.mean(flatness)),
        "flatness_std": float(np.std(flatness)),
        "spectral_entropy_std": entropy_std,
        "hf_mean": hf_mean,
        "hf_cv": hf_cv,
        "ioi_cv": ioi_cv,
        "grid_precision": grid_precision,
        "dynamic_spread_db": dynamic_spread,
        "crest_std_db": crest_std,
        "macro_loudness_std_db": macro_loudness_std,
        "corr_mean": corr_mean,
        "corr_std": corr_std,
        "width_mean": width_mean,
        "width_cv": width_cv,
        "spectral_stationarity": spectral_stationarity,
        "spectral_stationarity_std": spectral_stationarity_std,
        "texture_ratio": texture_ratio,
        "spectrum": log_bin_spectrum(freqs, mean_power),
        "energy": energy_curve(mono, sr),
    }


def aggregate_features(parts: list[dict[str, Any]]) -> dict[str, Any]:
    keys = [k for k, v in parts[0].items() if isinstance(v, (int, float))]
    out = {k: float(np.mean([p[k] for p in parts])) for k in keys}
    # Window-to-window variability is valuable counter-evidence against false positives.
    for k in ("grid_precision", "dynamic_spread_db", "width_mean", "spectral_stationarity", "flatness_mean"):
        out[k + "_between_std"] = float(np.std([p[k] for p in parts])) if len(parts) > 1 else 0.0

    specs = [np.array(p["spectrum"], dtype=float) for p in parts]
    if len(specs) > 1:
        cors = []
        for i in range(len(specs)):
            for j in range(i+1, len(specs)):
                a = specs[i] - np.mean(specs[i]); b = specs[j] - np.mean(specs[j])
                den = np.linalg.norm(a)*np.linalg.norm(b) + EPS
                cors.append(float(np.dot(a,b)/den))
        out["cross_section_spectral_consistency"] = float(np.mean(cors)) if cors else 0.5
        out["cross_section_spectral_consistency_std"] = float(np.std(cors)) if cors else 0.0
    else:
        out["cross_section_spectral_consistency"] = 0.5
        out["cross_section_spectral_consistency_std"] = 0.0

    out["spectrum"] = [round(float(v), 2) for v in np.mean(np.stack(specs), axis=0)]
    e = np.concatenate([np.array(p["energy"], dtype=float) for p in parts if p["energy"]]) if parts else np.array([])
    if e.size:
        idx = np.linspace(0, e.size-1, min(200, e.size)).astype(int)
        out["energy"] = [round(float(v), 2) for v in e[idx]]
    else:
        out["energy"] = []
    return out


def score_layers(f: dict[str, Any], container: dict[str, Any]) -> tuple[list[dict[str, Any]], float, float, list[str], bool, bool, dict[str, float]]:
    reasons: list[str] = []

    # L1 provenance. Structured provenance beats waveform guesswork.
    prov = 50.0
    prov_rel = 0.10
    strong_provenance = False
    if container.get("explicit_ai_manifest"):
        prov = 98.0
        prov_rel = 0.995
        strong_provenance = True
        bits = []
        if container.get("claim_generator"):
            bits.append(str(container["claim_generator"]))
        elif container.get("manifest_vendor_hits"):
            bits.append(", ".join(container["manifest_vendor_hits"]))
        if container.get("digital_source_types"):
            bits.append("/".join(container["digital_source_types"]))
        suffix = (" (" + "; ".join(bits) + ")") if bits else ""
        reasons.append("Structured provenance declares algorithmic/generated media" + suffix + ".")
    elif container["vendor_hits"]:
        prov = min(97.0, 84.0 + container["provenance_strength"] * 0.4)
        prov_rel = 0.98
        strong_provenance = True
        reasons.append("Ordinary metadata explicitly names an AI-generation service: " + ", ".join(container["vendor_hits"]))
    elif container.get("manifest_vendor_hits") and container.get("c2pa_markers"):
        prov = 86.0
        prov_rel = 0.90
        strong_provenance = True
        reasons.append("A structured provenance region names a known generation service: " + ", ".join(container["manifest_vendor_hits"]))
    elif container["c2pa_markers"]:
        prov = 50.0
        prov_rel = 0.30
        reasons.append("Structured C2PA/JUMBF provenance is present, but it does not itself declare AI origin.")
    else:
        reasons.append("No explicit AI-generator provenance was found. Absence of provenance is neutral, not human proof.")

    # Support values are kept continuous. v0.6 deliberately avoids forcing weak/no-evidence
    # layers into the same low-40s bucket; this preserves score resolution across different
    # human productions while keeping the verdict conservative.
    stat = clamp((f["spectral_stationarity"] - 0.80) / 0.16)
    stat_stable = clamp((0.08 - f["spectral_stationarity_std"]) / 0.07)
    hf_stable = clamp((0.45 - f["hf_cv"]) / 0.38) * clamp(f["hf_mean"] / 0.012)
    texture = clamp((math.log10(max(f["texture_ratio"], 1.0)) - 0.70) / 0.75)
    entropy_static = clamp((0.028 - f["spectral_entropy_std"]) / 0.024)
    generic_spectral_support = 0.35*(stat*stat_stable) + 0.30*(hf_stable*stat) + 0.20*(entropy_static*stat) + 0.15*(texture*stat)

    comb_support = clamp(f.get("vocoder_comb_support", 0.0))
    strong_fingerprint = bool(
        f.get("vocoder_comb_strength", 0.0) >= 0.16
        and f.get("vocoder_comb_peak_ratio", 0.0) >= 3.0
        and comb_support >= 0.55
    )
    if strong_fingerprint:
        spectral = 42.0 + 50.0*comb_support
        reasons.append(
            "A persistent vocoder-like spectral comb was detected "
            f"(~{f.get('vocoder_comb_spacing_hz', 0.0):.0f} Hz spacing; "
            f"{f.get('vocoder_comb_peak_ratio', 0.0):.1f}x local comb baseline)."
        )
    else:
        # Weak comb residue can contribute a little, but generic tonal/spectral behavior stays
        # deliberately low-weight because genre and mastering can mimic it.
        spectral = 40.0 + 38.0*generic_spectral_support + 18.0*comb_support
    spectral = max(34.0, min(92.0, spectral))

    precision = clamp((f["grid_precision"] - 0.72) / 0.26)
    ioi_regular = clamp((0.42 - f["ioi_cv"]) / 0.34)
    flat_dyn = clamp((5.5 - f["dynamic_spread_db"]) / 4.5)
    timing_support = precision * ioi_regular * (0.35 + 0.65*flat_dyn)
    temporal = 39.0 + 22.0*timing_support
    temporal = max(35.0, min(61.0, temporal))

    flat_crest = clamp((2.0 - f["crest_std_db"]) / 1.65)
    macro_flat = clamp((2.6 - f["macro_loudness_std_db"]) / 2.1)
    dynamics_support = 0.45*(flat_dyn*flat_crest) + 0.35*(flat_dyn*macro_flat) + 0.20*(flat_crest*macro_flat)
    dynamics = 38.0 + 28.0*dynamics_support
    dynamics = max(34.0, min(66.0, dynamics))

    width_static = clamp((0.38 - f["width_cv"]) / 0.33)
    corr_static = clamp((0.09 - f["corr_std"]) / 0.08)
    width_between_static = clamp((0.14 - f.get("width_mean_between_std", 0.0)) / 0.12)
    stereo_support = width_static * corr_static * (0.5 + 0.5*width_between_static)
    stereo = 40.0 + 20.0*stereo_support
    stereo = max(36.0, min(62.0, stereo))

    xcons = clamp((f["cross_section_spectral_consistency"] - 0.88) / 0.10)
    xcons_stable = clamp((0.055 - f["cross_section_spectral_consistency_std"]) / 0.05)
    flat_var = clamp((0.035 - f["flatness_std"]) / 0.030)
    consistency_support = xcons * (0.55*xcons_stable + 0.45*flat_var)
    consistency = 39.0 + 22.0*consistency_support
    consistency = max(35.0, min(63.0, consistency))

    layers = [
        {"id": 1, "name": "Provenance & Manifest", "score": round(prov, 1), "reliability": prov_rel,
         "detail": "Checks ordinary tags, container clues and C2PA/JUMBF markers. Only explicit generator metadata is strong evidence in this preview."},
        {"id": 2, "name": "Vocoder / Spectral Fingerprint", "score": round(spectral, 1), "reliability": 0.72 if strong_fingerprint else 0.30,
         "detail": (
             f"Persistent comb check: {f.get('vocoder_comb_peak_ratio', 0.0):.1f}x baseline at ~{f.get('vocoder_comb_spacing_hz', 0.0):.0f} Hz spacing. "
             + ("This is strong architecture-level evidence, but not generator proof." if strong_fingerprint else "No strong persistent decoder-comb signature was found; generic spectrum traits stay low-weight.")
         )},
        {"id": 3, "name": "Timing & Micro-Precision", "score": round(temporal, 1), "reliability": 0.16,
         "detail": "Grid precision alone is never treated as AI evidence. Quantized human electronic music is a known hard negative."},
        {"id": 4, "name": "Dynamics & Transients", "score": round(dynamics, 1), "reliability": 0.18,
         "detail": "Looks for several forms of dynamic invariance together. Heavy limiting or sample-based production can mimic these cues."},
        {"id": 5, "name": "Stereo & Phase Behavior", "score": round(stereo, 1), "reliability": 0.12,
         "detail": "Only unusually invariant width plus phase behavior contributes. Stereo processing by itself is not an origin marker."},
        {"id": 6, "name": "Cross-Section Consistency", "score": round(consistency, 1), "reliability": 0.18,
         "detail": "Requires high similarity across distant sections plus low feature variance. Repetitive human music remains a known hard negative."},
    ]

    heur = np.array([spectral, temporal, dynamics, stereo, consistency], dtype=float)
    rel = np.array([0.72 if strong_fingerprint else 0.30, 0.16, 0.18, 0.12, 0.18], dtype=float)
    weights = np.array([2.10 if strong_fingerprint else 1.25, 0.75, 0.95, 0.55, 1.0], dtype=float)
    heur_mean = float(np.average(heur, weights=weights))

    # Continuous human-like counterevidence. This remains a penalty against an AI score, never a
    # proof of human authorship. Giving it more resolution fixes the old 43/44 scoring plateau.
    human_counter = 0.0
    human_counter += 0.30 * clamp((f["dynamic_spread_db"] - 7.5) / 7.5)
    human_counter += 0.20 * clamp((f["crest_std_db"] - 2.5) / 3.0)
    human_counter += 0.20 * clamp((f["ioi_cv"] - 0.50) / 0.55)
    human_counter += 0.15 * clamp((f["width_cv"] - 0.45) / 0.70)
    human_counter += 0.15 * clamp((0.82 - f["cross_section_spectral_consistency"]) / 0.30)

    generic_ai_support = float(np.average(
        np.array([generic_spectral_support, timing_support, dynamics_support, stereo_support, consistency_support], dtype=float),
        weights=np.array([0.20, 0.18, 0.22, 0.15, 0.25], dtype=float),
    ))

    adjusted_heur = heur_mean - 18.0*human_counter

    if strong_provenance:
        overall = 0.82*prov + 0.18*adjusted_heur
    elif container.get("manifest_vendor_hits"):
        overall = 0.24*prov + 0.76*adjusted_heur
    elif strong_fingerprint:
        # Fingerprint evidence gets substantial weight, but human-like behavior can shave a few
        # points so edited/complex audio is not forced to the same fixed score.
        other_mean = float(np.average(np.array([temporal, dynamics, stereo, consistency]), weights=np.array([0.75,0.95,0.55,1.0])))
        overall = 0.62*spectral + 0.38*other_mean - 5.0*human_counter
        overall = max(30.0, min(84.0, overall))
    else:
        overall = adjusted_heur
        # Generic behavior alone cannot make a strong AI accusation.
        overall = max(24.0, min(64.0, overall))

    # Evidence strength is deliberately not a probability. v0.6 bases it on several continuous
    # factors instead of a mostly fixed directional-agreement bucket: distance from neutral,
    # weighted layer magnitude, directional coherence, and direction-specific supporting evidence.
    dev = heur - 50.0
    active = np.abs(dev) >= 1.5
    if np.any(active):
        active_rel = rel[active]
        active_dev = dev[active]
        pos = float(np.sum(active_rel[active_dev > 0]))
        neg = float(np.sum(active_rel[active_dev < 0]))
        denom = pos + neg
        directional_coherence = (max(pos, neg) / denom) if denom > EPS else 0.5
    else:
        directional_coherence = 0.5
    evidence_quality = clamp(float(np.average(np.abs(dev), weights=rel)) / 16.0)
    score_margin = clamp(abs(overall - 50.0) / 25.0)
    directional_specific = human_counter if overall < 50.0 else max(generic_ai_support, comb_support*0.85)

    agreement = (
        30.0
        + 16.0*directional_coherence
        + 28.0*score_margin
        + 14.0*evidence_quality
        + 20.0*clamp(directional_specific)
    )
    if strong_provenance:
        agreement = max(agreement, 94.0)
    elif strong_fingerprint:
        agreement = max(agreement, 82.0 + 10.0*comb_support)
        agreement = min(93.0, agreement)
    elif container.get("manifest_vendor_hits"):
        agreement = min(84.0, agreement + 5.0)
    else:
        agreement = min(84.0, agreement)
    agreement = max(30.0, min(98.0, agreement))

    diagnostics = {
        "generic_ai_support": round(generic_ai_support, 4),
        "human_counterevidence": round(human_counter, 4),
        "directional_coherence": round(directional_coherence, 4),
        "evidence_quality": round(evidence_quality, 4),
        "score_margin": round(score_margin, 4),
        "comb_support": round(comb_support, 4),
    }

    return layers, round(overall, 1), round(agreement, 1), reasons, strong_provenance, strong_fingerprint, diagnostics

def verdict(score: float, strong_provenance: bool, strong_fingerprint: bool) -> tuple[str, str]:
    if strong_provenance and score >= 70:
        return "likely_ai", "Likely AI-generated"
    if strong_fingerprint and score >= 62:
        return "ai_like", "Likely AI-generated"
    if score <= 46:
        return "likely_human", "Likely human-produced"
    if score >= 59:
        return "ai_like", "AI-leaning evidence"
    return "uncertain", "Indeterminate"


def analyze(path: Path, mode: str = "fast") -> dict[str, Any]:
    t0 = time.perf_counter()
    mode = "deep" if mode == "deep" else "fast"
    profile = analysis_profile(mode)
    probe = probe_audio(path)
    if probe["duration"] <= 0:
        raise ValueError("Could not determine audio duration.")
    container = scan_container(path, probe)
    windows = choose_windows(probe["duration"], mode)
    sr = int(profile["sample_rate"])
    fft_size = int(profile["fft_size"])
    hop = int(profile["hop"])
    parts = []
    for start, dur in windows:
        audio = decode_segment(path, start, dur, sr)
        parts.append(segment_features(audio, sr, fft_size, hop))
    feat = aggregate_features(parts)
    # Long-average architecture fingerprint: cheap, genre-light, and intentionally separate from
    # the short musical-behavior windows. This catches decoder combs that disappear when a song is
    # reduced to only broad spectrum/dynamics statistics.
    comb = vocoder_comb_features(decode_fakeprint_audio(path, min(180.0, probe["duration"])))
    feat.update(comb)
    layers, score, agreement, reasons, strong_provenance, strong_fingerprint, diagnostics = score_layers(feat, container)
    key, label = verdict(score, strong_provenance, strong_fingerprint)
    elapsed = time.perf_counter() - t0

    cautions = [
        "Evidence strength is not a probability that the track is AI-generated.",
        "Generic production-style heuristics cannot produce a strong AI-origin verdict; a persistent decoder-comb fingerprint may produce a strong AI-like signal verdict, still marked unconfirmed without provenance or a trained classifier.",
        "Human DAW productions can be highly quantized/compressed, and AI music can be edited to look more human.",
        "A missing watermark or metadata tag does not prove human authorship.",
        "This build does not claim to decode proprietary watermarks such as Google's SynthID.",
    ]

    return {
        "schema": "ysong-ai-detector-report-v6",
        "analysis_id": uuid.uuid4().hex,
        "mode": mode,
        "elapsed_seconds": round(elapsed, 3),
        "analysis_profile": {
            "sampled_windows": len(windows),
            "decode_sample_rate": sr,
            "fft_size": fft_size,
            "segment_seconds": profile["segment_seconds"],
        },
        "verdict": key,
        "verdict_label": label,
        "ai_evidence_score": score,
        "evidence_agreement": agreement,
        "confidence": agreement,  # legacy UI/API compatibility; no longer described as probability/confidence
        "strong_provenance": strong_provenance,
        "strong_signal_fingerprint": strong_fingerprint,
        "file": {
            "name": path.name,
            "duration_seconds": round(probe["duration"], 3),
            "sample_rate": probe["sample_rate"],
            "channels": probe["channels"],
            "codec": probe["codec"],
            "format": probe["format"],
        },
        "provenance": {
            "metadata": container["tags"],
            "generator_metadata_hits": container["vendor_hits"],
            "manifest_generator_hits": container.get("manifest_vendor_hits", []),
            "c2pa_markers": container["c2pa_markers"],
            "digital_source_types": container.get("digital_source_types", []),
            "claim_generator": container.get("claim_generator"),
            "explicit_ai_manifest": bool(container.get("explicit_ai_manifest")),
        },
        "layers": layers,
        "reasons": reasons,
        "measurements": {
            "crest_db": round(feat["crest_db"], 2),
            "dynamic_spread_db": round(feat["dynamic_spread_db"], 2),
            "macro_loudness_std_db": round(feat["macro_loudness_std_db"], 2),
            "onset_grid_precision": round(feat["grid_precision"], 3),
            "inter_onset_cv": round(feat["ioi_cv"], 3),
            "spectral_stationarity": round(feat["spectral_stationarity"], 3),
            "spectral_stationarity_variation": round(feat["spectral_stationarity_std"], 3),
            "spectral_flatness": round(feat["flatness_mean"], 4),
            "spectral_entropy_variation": round(feat["spectral_entropy_std"], 4),
            "high_frequency_ratio": round(feat["hf_mean"], 5),
            "stereo_correlation": round(feat["corr_mean"], 3),
            "stereo_width_ratio": round(feat["width_mean"], 3),
            "stereo_width_variation": round(feat["width_cv"], 3),
            "cross_section_spectral_consistency": round(feat["cross_section_spectral_consistency"], 3),
            "vocoder_comb_strength": round(feat.get("vocoder_comb_strength", 0.0), 4),
            "vocoder_comb_peak_ratio": round(feat.get("vocoder_comb_peak_ratio", 0.0), 3),
            "vocoder_comb_spacing_hz": round(feat.get("vocoder_comb_spacing_hz", 0.0), 2),
            "generic_ai_support": diagnostics["generic_ai_support"],
            "human_counterevidence": diagnostics["human_counterevidence"],
            "directional_coherence": diagnostics["directional_coherence"],
            "evidence_quality": diagnostics["evidence_quality"],
            "score_margin": diagnostics["score_margin"],
        },
        "visuals": {"spectrum_db": feat["spectrum"], "energy_db": feat["energy"], "fakeprint": feat.get("fakeprint", [])},
        "windows": [{"start": round(s,2), "duration": round(d,2)} for s,d in windows],
        "cautions": cautions,
    }
