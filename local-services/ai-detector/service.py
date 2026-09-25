from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENDOR_FFMPEG = ROOT / "vendor" / "ffmpeg"
if VENDOR_FFMPEG.exists():
    os.environ["PATH"] = str(VENDOR_FFMPEG) + os.pathsep + os.environ.get("PATH", "")


def ensure_media_tools() -> None:
    if shutil.which("ffmpeg") and shutil.which("ffprobe"):
        return
    if os.name != "nt":
        raise RuntimeError("FFmpeg and FFprobe are required for YSong AI Detector.")
    from scripts.ensure_ffmpeg import ensure_ffmpeg
    print("[YSong AI Detector] FFmpeg not found; installing portable local copy...", flush=True)
    ensure_ffmpeg(ROOT)
    os.environ["PATH"] = str(VENDOR_FFMPEG) + os.pathsep + os.environ.get("PATH", "")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8790)
    args = parser.parse_args()
    ensure_media_tools()
    import uvicorn
    uvicorn.run("backend.app:app", host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
