FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PORT=3100
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server.mjs security.mjs ./
USER pwuser
EXPOSE 3100
CMD ["node", "server.mjs"]
