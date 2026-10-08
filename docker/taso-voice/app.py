from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path
from typing import Literal

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask

VOICE_DIR = Path(os.getenv("TASO_VOICE_PACK_DIR", "/voices"))
MANIFEST_PATH = Path(os.getenv("TASO_VOICE_MANIFEST", str(VOICE_DIR / "voices.json")))
FREYA_MODEL = os.getenv("TASO_FREYA_MODEL", "freyavoice/freya-tts")
FREYA_DEVICE = os.getenv("TASO_FREYA_DEVICE", "cpu")
FREYA_STEPS = max(12, min(48, int(os.getenv("TASO_FREYA_STEPS", "32"))))

app = FastAPI(title="Taso Local Neural Voice", version="0.2.0")


class VoiceProfile(BaseModel):
    id: str
    label: str
    gender: Literal["male", "female", "neutral"] = "neutral"
    locale: str = "tr-TR"
    seed: int
    license: str = "Apache-2.0"
    commercialAllowed: bool = True
    character: str = "signature"


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1500)
    voiceId: str | None = None
    speed: float | None = Field(default=None, ge=0.72, le=1.12)


DEFAULT_VOICES = [
    VoiceProfile(
        id="taso-signature-female",
        label="Taso Signature Kadın",
        gender="female",
        seed=9,
        license="Apache-2.0 · FreyaTTS-small",
        commercialAllowed=True,
        character="signature",
    ),
    VoiceProfile(
        id="taso-candidate-17",
        label="Taso Aday 17",
        gender="neutral",
        seed=17,
        license="Apache-2.0 · FreyaTTS-small",
        commercialAllowed=True,
        character="candidate",
    ),
    VoiceProfile(
        id="taso-candidate-31",
        label="Taso Aday 31",
        gender="neutral",
        seed=31,
        license="Apache-2.0 · FreyaTTS-small",
        commercialAllowed=True,
        character="candidate",
    ),
    VoiceProfile(
        id="taso-candidate-47",
        label="Taso Aday 47",
        gender="neutral",
        seed=47,
        license="Apache-2.0 · FreyaTTS-small",
        commercialAllowed=True,
        character="candidate",
    ),
]

_tts = None
_load_error: str | None = None
_loading = False
_load_lock = threading.Lock()


def load_profiles() -> list[VoiceProfile]:
    if not MANIFEST_PATH.exists():
        return DEFAULT_VOICES
    try:
        raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        items = raw.get("voices", []) if isinstance(raw, dict) else []
        profiles = [VoiceProfile.model_validate(item) for item in items]
    except Exception as exc:
        raise RuntimeError(f"Invalid voice manifest: {exc}") from exc
    return [profile for profile in profiles if profile.commercialAllowed]


def public_voice(profile: VoiceProfile) -> dict:
    return {
        "id": profile.id,
        "label": profile.label,
        "gender": profile.gender,
        "locale": profile.locale,
        "license": profile.license,
        "character": profile.character,
        "seed": profile.seed,
    }


def ensure_model():
    global _tts, _load_error, _loading
    if _tts is not None:
        return _tts
    with _load_lock:
        if _tts is not None:
            return _tts
        _loading = True
        _load_error = None
        try:
            from freyatts import FreyaTTS

            _tts = FreyaTTS.from_pretrained(FREYA_MODEL, device=FREYA_DEVICE)
            return _tts
        except Exception as exc:
            _load_error = str(exc)
            raise
        finally:
            _loading = False


def warm_model():
    try:
        ensure_model()
    except Exception:
        # Health reports the exact failure without crashing the container.
        pass


@app.on_event("startup")
def startup():
    threading.Thread(target=warm_model, daemon=True).start()


@app.get("/health")
def health():
    voices = load_profiles()
    return {
        "ready": _tts is not None and bool(voices),
        "loading": _loading,
        "engine": "freyatts-small",
        "provider": "self-hosted",
        "model": FREYA_MODEL,
        "device": FREYA_DEVICE,
        "steps": FREYA_STEPS,
        "license": "Apache-2.0",
        "voices": [public_voice(v) for v in voices],
        "error": _load_error,
    }


@app.post("/synthesize")
def synthesize(req: SynthesisRequest):
    voices = load_profiles()
    if not voices:
        raise HTTPException(status_code=503, detail="No production-cleared Taso voice profile is installed.")

    selected = next((v for v in voices if v.id == req.voiceId), None) if req.voiceId else voices[0]
    if selected is None:
        raise HTTPException(status_code=404, detail="Requested Taso voice profile is not available.")

    try:
        tts = ensure_model()
        wav = tts.synthesize(req.text, steps=FREYA_STEPS, seed=selected.seed)
        if req.speed and abs(req.speed - 1.0) > 0.01:
            import librosa

            wav = librosa.effects.time_stretch(np.asarray(wav, dtype=np.float32), rate=req.speed)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"FreyaTTS synthesis failed: {str(exc)[-400:]}") from exc

    output = tempfile.NamedTemporaryFile(prefix="taso-", suffix=".wav", delete=False)
    output.close()
    try:
        tts.save_wav(np.asarray(wav, dtype=np.float32), output.name)
    except Exception as exc:
        Path(output.name).unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Audio write failed: {exc}") from exc

    return FileResponse(
        output.name,
        media_type="audio/wav",
        filename="taso.wav",
        background=BackgroundTask(Path(output.name).unlink, missing_ok=True),
    )
