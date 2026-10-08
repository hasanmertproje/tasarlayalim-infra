FROM python:3.11-slim

ARG FREYA_TTS_COMMIT=146d36c1cb6660646be57d31339db4eed9315de3
ARG VOXCPM_COMMIT=cce58a5b59303c9bd63d12f23afe6a49a4a80c59
ARG TORCH_VERSION=2.8.0

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/opt/FreyaTTS \
    TASO_VOICE_DEVICE=cpu

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# Taso Voice is CPU-only. Install CPU wheels explicitly so pip never resolves
# CUDA/NVIDIA runtime packages for torch/torchaudio.
RUN pip install --no-cache-dir \
    --index-url https://download.pytorch.org/whl/cpu \
    "torch==${TORCH_VERSION}" \
    "torchaudio==${TORCH_VERSION}"

RUN mkdir -p /opt/FreyaTTS \
    && cd /opt/FreyaTTS \
    && git init \
    && git remote add origin https://github.com/freyavoiceai/FreyaTTS.git \
    && git fetch --depth 1 origin "$FREYA_TTS_COMMIT" \
    && git checkout --detach FETCH_HEAD \
    && python - <<'PY'
from pathlib import Path
from urllib.request import urlopen

root = Path('/opt/FreyaTTS')
requirements = root / 'requirements.txt'
filtered = []
for line in requirements.read_text(encoding='utf-8').splitlines():
    stripped = line.strip()
    if stripped.lower() == 'voxcpm':
        continue
    filtered.append(line)
requirements.write_text('\n'.join(filtered) + '\n', encoding='utf-8')

voxcpm_commit = 'cce58a5b59303c9bd63d12f23afe6a49a4a80c59'
base = f'https://raw.githubusercontent.com/OpenBMB/VoxCPM/{voxcpm_commit}'

audiovae = urlopen(base + '/src/voxcpm/modules/audiovae/audio_vae_v2.py', timeout=30).read().decode('utf-8')
(root / 'freyatts' / '_audiovae_v2.py').write_text(audiovae, encoding='utf-8')

license_text = urlopen(base + '/LICENSE', timeout=30).read().decode('utf-8')
(root / 'THIRD_PARTY_VOXCPM_LICENSE').write_text(license_text, encoding='utf-8')

vae = root / 'freyatts' / 'vae.py'
source = vae.read_text(encoding='utf-8')
needle = 'from voxcpm.modules.audiovae import AudioVAEV2, AudioVAEConfigV2'
replacement = 'from ._audiovae_v2 import AudioVAE as AudioVAEV2, AudioVAEConfig as AudioVAEConfigV2'
if needle not in source:
    raise RuntimeError('FreyaTTS AudioVAE import contract changed; refusing an unsafe patch')
vae.write_text(source.replace(needle, replacement), encoding='utf-8')
PY
RUN pip install --no-cache-dir -r /opt/FreyaTTS/requirements.txt \
    && rm -rf /opt/FreyaTTS/.git

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py
RUN mkdir -p /voices /root/.cache/huggingface

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
