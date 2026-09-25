from __future__ import annotations

import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

WINDOWS_FFMPEG_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"


def ensure_ffmpeg(root: Path) -> None:
    target = root / "vendor" / "ffmpeg"
    ffmpeg = target / "ffmpeg.exe"
    ffprobe = target / "ffprobe.exe"
    if ffmpeg.exists() and ffprobe.exists():
        return
    target.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ysong_ffmpeg_") as td:
        archive = Path(td) / "ffmpeg.zip"
        print("Downloading portable FFmpeg (~100 MB)...")
        urllib.request.urlretrieve(WINDOWS_FFMPEG_URL, archive)
        with zipfile.ZipFile(archive) as zf:
            ffmpeg_member = next((n for n in zf.namelist() if n.endswith("/bin/ffmpeg.exe")), None)
            ffprobe_member = next((n for n in zf.namelist() if n.endswith("/bin/ffprobe.exe")), None)
            if not ffmpeg_member or not ffprobe_member:
                raise RuntimeError("Downloaded FFmpeg package did not contain ffmpeg.exe and ffprobe.exe.")
            with zf.open(ffmpeg_member) as src, ffmpeg.open("wb") as dst:
                shutil.copyfileobj(src, dst)
            with zf.open(ffprobe_member) as src, ffprobe.open("wb") as dst:
                shutil.copyfileobj(src, dst)
    print("Portable FFmpeg installed for YSong AI Detector.")
