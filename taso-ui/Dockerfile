FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
ARG VITE_TASO_API_URL="/api"
ENV VITE_TASO_API_URL=${VITE_TASO_API_URL}
RUN npm run build

FROM nginx:1.27-alpine
ENV TASO_CORE_UPSTREAM=http://taso-core:3000
ENV NGINX_ENVSUBST_FILTER='TASO_'
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
