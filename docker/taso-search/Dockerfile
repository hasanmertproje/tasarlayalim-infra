FROM ghcr.io/searxng/searxng:2026.10.4-d48c4b555@sha256:b0497f6e93b5e98b1a15c66b333afed176266af34f479a46ed87514f4a441eda
COPY settings.yml /etc/searxng/settings.yml
EXPOSE 8080
# SearXNG process liveness only; do not depend on external search engines.
# urllib is part of the Python runtime in the SearXNG base image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD python3 -c "import urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8080/', timeout=3); assert 200 <= r.status < 400"
