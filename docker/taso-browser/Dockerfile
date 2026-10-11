FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PORT=3100
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm audit --omit=dev --audit-level=high
COPY server.mjs security.mjs ./
USER pwuser
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=12 CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3100)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.mjs"]
