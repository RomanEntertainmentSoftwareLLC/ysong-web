from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
REQ = ROOT / "requirements.txt"
STAMP = VENV / ".ysong-requirements-v1"


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def ensure_runtime() -> Path:
    py = venv_python()
    if not py.exists():
        print("[YSong AI Detector] Creating local Python environment...", flush=True)
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
    if not STAMP.exists():
        print("[YSong AI Detector] Installing detector runtime (first launch only)...", flush=True)
        subprocess.check_call([str(py), "-m", "pip", "install", "--disable-pip-version-check", "-r", str(REQ)])
        STAMP.write_text("0.6.0\n", encoding="utf-8")
    return py


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8790)
    args = parser.parse_args()
    py = ensure_runtime()
    service = ROOT / "service.py"
    os.execv(str(py), [str(py), str(service), "--port", str(args.port)])


if __name__ == "__main__":
    main()
