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

COPY prepare_freya_cpu.py /tmp/prepare_freya_cpu.py

RUN mkdir -p /opt/FreyaTTS \
    && cd /opt/FreyaTTS \
    && git init \
    && git remote add origin https://github.com/freyavoiceai/FreyaTTS.git \
    && git fetch --depth 1 origin "$FREYA_TTS_COMMIT" \
    && git checkout --detach FETCH_HEAD \
    && python /tmp/prepare_freya_cpu.py "$VOXCPM_COMMIT" \
    && pip install --no-cache-dir -r requirements.txt \
    && rm -rf /opt/FreyaTTS/.git /tmp/prepare_freya_cpu.py

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py
RUN mkdir -p /voices /root/.cache/huggingface

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
