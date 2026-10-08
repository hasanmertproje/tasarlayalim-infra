FROM python:3.11-slim

ARG FREYA_TTS_COMMIT=146d36c1cb6660646be57d31339db4eed9315de3

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/opt/FreyaTTS

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends git libsndfile1 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/freyavoiceai/FreyaTTS.git /opt/FreyaTTS \
    && cd /opt/FreyaTTS \
    && git checkout "$FREYA_TTS_COMMIT" \
    && pip install --no-cache-dir -r requirements.txt

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY app.py /app/app.py
RUN mkdir -p /voices /root/.cache/huggingface

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
