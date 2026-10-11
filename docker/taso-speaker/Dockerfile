FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=3200 TASO_SPEAKER_DATA_DIR=/data
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && apt-get purge -y --auto-remove build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY app.py ./
RUN mkdir -p /data && chown -R nobody:nogroup /data /app
USER nobody
EXPOSE 3200
HEALTHCHECK --interval=15s --timeout=8s --start-period=60s --retries=6 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:' + str(__import__('os').environ.get('PORT','3200')) + '/health', timeout=4)"
CMD ["sh","-c","uvicorn app:app --host 0.0.0.0 --port ${PORT:-3200}"]
