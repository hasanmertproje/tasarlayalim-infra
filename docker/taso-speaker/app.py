import base64
import io
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from resemblyzer import VoiceEncoder, preprocess_wav

DATA_DIR = Path(os.environ.get("TASO_SPEAKER_DATA_DIR", "/data"))
SECRET = os.environ.get("TASO_SPEAKER_SERVICE_SECRET", "")
PORT = int(os.environ.get("PORT", "3200"))
MAX_AUDIO_BYTES = 2_200_000
PROFILES_FILE = DATA_DIR / "profiles.json"

app = FastAPI(title="Taso Speaker Recognition", docs_url=None, redoc_url=None)
encoder = VoiceEncoder()

class AudioInput(BaseModel):
    audioBase64: str
    mime: str = "audio/webm"
    userId: Optional[str] = None
    label: Optional[str] = None
    limit: int = 3


def require_auth(authorization: Optional[str]):
    if not SECRET or authorization != f"Bearer {SECRET}":
        raise HTTPException(status_code=401, detail="Speaker service authorization required.")


def load_profiles():
    if not PROFILES_FILE.exists():
        return {}
    try:
        raw = json.loads(PROFILES_FILE.read_text("utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def save_profiles(profiles):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = PROFILES_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(profiles, ensure_ascii=False, indent=2), "utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(PROFILES_FILE)


def decode_audio(value: str):
    try:
        data = base64.b64decode(value, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid base64 audio.") from exc
    if not data or len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=400, detail="Audio sample size is outside the allowed range.")
    return data


def to_wav(data: bytes, mime: str):
    suffix = ".webm"
    if "wav" in mime:
        suffix = ".wav"
    elif "ogg" in mime:
        suffix = ".ogg"
    elif "mpeg" in mime or "mp3" in mime:
        suffix = ".mp3"
    elif "mp4" in mime or "m4a" in mime:
        suffix = ".m4a"
    with tempfile.TemporaryDirectory(prefix="taso-speaker-") as tmpdir:
        src = Path(tmpdir) / f"sample{suffix}"
        dst = Path(tmpdir) / "sample.wav"
        src.write_bytes(data)
        if suffix == ".wav":
            dst.write_bytes(data)
        else:
            try:
                subprocess.run([
                    "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(src),
                    "-ac", "1", "-ar", "16000", str(dst)
                ], check=True, timeout=15)
            except Exception as exc:
                raise HTTPException(status_code=400, detail="Audio could not be decoded.") from exc
        wav = preprocess_wav(dst)
        if wav.size < 16000:
            raise HTTPException(status_code=400, detail="Voice sample is too short.")
        return wav


def embedding(payload: AudioInput):
    wav = to_wav(decode_audio(payload.audioBase64), payload.mime)
    vector = encoder.embed_utterance(wav)
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm == 0:
        raise HTTPException(status_code=400, detail="Voice embedding could not be generated.")
    return (vector / norm).astype(np.float32)


@app.get("/health")
def health():
    return {"ok": True, "service": "taso-speaker", "model": "resemblyzer", "authority": "conversational_only"}


@app.post("/enroll")
def enroll(payload: AudioInput, authorization: Optional[str] = Header(default=None)):
    require_auth(authorization)
    if not payload.userId:
        raise HTTPException(status_code=400, detail="userId is required.")
    vector = embedding(payload)
    profiles = load_profiles()
    current = profiles.get(payload.userId, {})
    samples = current.get("samples", []) if isinstance(current, dict) else []
    samples = samples[-3:] + [vector.tolist()]
    avg = np.mean(np.asarray(samples, dtype=np.float32), axis=0)
    avg /= max(float(np.linalg.norm(avg)), 1e-8)
    profiles[payload.userId] = {
        "userId": payload.userId,
        "label": (payload.label or payload.userId)[:80],
        "embedding": avg.tolist(),
        "samples": samples,
    }
    save_profiles(profiles)
    return {"voiceProfileId": f"voice_{payload.userId}", "samples": len(samples), "authority": "conversational_only"}


@app.post("/identify")
def identify(payload: AudioInput, authorization: Optional[str] = Header(default=None)):
    require_auth(authorization)
    vector = embedding(payload)
    profiles = load_profiles()
    scored = []
    for user_id, profile in profiles.items():
        raw = profile.get("embedding") if isinstance(profile, dict) else None
        if not isinstance(raw, list):
            continue
        known = np.asarray(raw, dtype=np.float32)
        if known.shape != vector.shape:
            continue
        denom = max(float(np.linalg.norm(known) * np.linalg.norm(vector)), 1e-8)
        score = float(np.dot(known, vector) / denom)
        scored.append({"userId": user_id, "label": profile.get("label", user_id), "confidence": max(0.0, min(1.0, score))})
    scored.sort(key=lambda item: item["confidence"], reverse=True)
    best = scored[0] if scored else {"confidence": 0.0}
    return {**best, "candidates": scored[: max(1, min(5, payload.limit))], "authority": "conversational_only"}
