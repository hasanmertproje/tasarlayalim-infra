FROM binwiederhier/ntfy:latest

COPY server.yml /etc/ntfy/server.yml

EXPOSE 80

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -q --tries=1 http://127.0.0.1:80/v1/health -O - | grep -q '"healthy":true' || exit 1

ENTRYPOINT ["ntfy", "serve"]
