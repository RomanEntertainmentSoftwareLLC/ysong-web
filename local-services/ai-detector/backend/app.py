from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from .analyzer import analyze


def _report_root() -> Path:
    configured = os.environ.get("YSONG_AI_DETECTOR_REPORTS", "").strip()
    if configured:
        root = Path(configured).expanduser()
    elif os.name == "nt" and os.environ.get("LOCALAPPDATA"):
        root = Path(os.environ["LOCALAPPDATA"]) / "YSong" / "AI Detector" / "reports"
    else:
        root = Path.home() / ".ysong" / "ai-detector" / "reports"
    root.mkdir(parents=True, exist_ok=True)
    return root


REPORTS = _report_root()
app = FastAPI(title="YSong AI Music Detector", version="0.6.0")


@app.get("/health")
def health():
    return {"ok": True, "service": "ysong-ai-detector", "version": "0.6.0"}


@app.get("/api/health")
def api_health():
    return health()


@app.post("/api/analyze")
async def analyze_file(file: UploadFile = File(...), mode: str = Form("fast")):
    mode = mode if mode in {"fast", "deep"} else "fast"
    suffix = Path(file.filename or "track.wav").suffix[:10] or ".audio"
    with tempfile.TemporaryDirectory(prefix="ysong-detector-") as td:
        source = Path(td) / ("source" + suffix)
        with source.open("wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        if source.stat().st_size <= 0:
            raise HTTPException(400, "Empty upload.")
        try:
            report = analyze(source, mode=mode)
        except Exception as exc:
            raise HTTPException(400, f"Could not analyze this audio file: {exc}") from exc

        report["file"]["name"] = file.filename or report["file"]["name"]
        report_path = REPORTS / f"{report['analysis_id']}.json"
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        # The React client builds the proxied URL from analysis_id. Keep this relative route
        # for direct-service debugging and backwards compatibility with the preview.
        report["report_url"] = f"/api/report/{report['analysis_id']}"
        return JSONResponse(report)


@app.get("/api/report/{analysis_id}")
def report(analysis_id: str):
    if not analysis_id.replace("-", "").isalnum():
        raise HTTPException(404)
    path = REPORTS / f"{analysis_id}.json"
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path, media_type="application/json", filename=f"YSong_AI_Detection_{analysis_id[:8]}.json")
