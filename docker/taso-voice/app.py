from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

VOICE_DIR = Path(os.getenv("TASO_VOICE_PACK_DIR", "/voices"))
MANIFEST_PATH = Path(os.getenv("TASO_VOICE_MANIFEST", str(VOICE_DIR / "voices.json")))
PIPER_BIN = os.getenv("PIPER_BIN", "piper")

app = FastAPI(title="Taso Local Voice", version="0.1.0")


class VoicePack(BaseModel):
    id: str
    label: str
    gender: Literal["male", "female", "neutral"] = "neutral"
    locale: str = "tr-TR"
    model: str
    config: str
    license: str
    commercialAllowed: bool = False
    character: str = "signature"


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    voiceId: str | None = None
    speed: float | None = Field(default=None, ge=0.7, le=1.25)


def load_manifest() -> list[VoicePack]:
    if not MANIFEST_PATH.exists():
        return []
    try:
        raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        items = raw.get("voices", []) if isinstance(raw, dict) else []
        packs = [VoicePack.model_validate(item) for item in items]
    except Exception as exc:
        raise RuntimeError(f"Invalid voice manifest: {exc}") from exc

    available: list[VoicePack] = []
    voice_root = VOICE_DIR.resolve()
    for pack in packs:
        if not pack.commercialAllowed:
            continue
        model = (VOICE_DIR / pack.model).resolve()
        config = (VOICE_DIR / pack.config).resolve()
        if voice_root not in model.parents or voice_root not in config.parents:
            continue
        if model.is_file() and config.is_file():
            available.append(pack)
    return available


def public_voice(pack: VoicePack) -> dict:
    return {
        "id": pack.id,
        "label": pack.label,
        "gender": pack.gender,
        "locale": pack.locale,
        "license": pack.license,
        "character": pack.character,
    }


@app.get("/health")
def health():
    voices = load_manifest()
    return {
        "ready": bool(voices),
        "engine": "piper-local",
        "provider": "self-hosted",
        "voices": [public_voice(v) for v in voices],
    }


@app.post("/synthesize")
def synthesize(req: SynthesisRequest):
    voices = load_manifest()
    if not voices:
        raise HTTPException(status_code=503, detail="No production-cleared local voice pack is installed.")

    selected = next((v for v in voices if v.id == req.voiceId), None) if req.voiceId else voices[0]
    if selected is None:
        raise HTTPException(status_code=404, detail="Requested voice pack is not available.")

    model = VOICE_DIR / selected.model
    config = VOICE_DIR / selected.config
    output = tempfile.NamedTemporaryFile(prefix="taso-", suffix=".wav", delete=False)
    output.close()

    command = [
        PIPER_BIN,
        "--model", str(model),
        "--config", str(config),
        "--output_file", output.name,
    ]
    if req.speed:
        command.extend(["--length_scale", str(round(1 / req.speed, 3))])

    try:
        subprocess.run(
            command,
            input=req.text.encode("utf-8"),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            check=True,
            timeout=30,
        )
    except subprocess.CalledProcessError as exc:
        Path(output.name).unlink(missing_ok=True)
        detail = exc.stderr.decode("utf-8", errors="replace")[-400:]
        raise HTTPException(status_code=500, detail=f"Voice synthesis failed: {detail}") from exc
    except subprocess.TimeoutExpired as exc:
        Path(output.name).unlink(missing_ok=True)
        raise HTTPException(status_code=504, detail="Voice synthesis timed out.") from exc

    return FileResponse(
        output.name,
        media_type="audio/wav",
        filename="taso.wav",
        background=BackgroundTask(Path(output.name).unlink, missing_ok=True),
    )
