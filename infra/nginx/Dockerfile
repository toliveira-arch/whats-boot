# syntax=docker/dockerfile:1
# Nginx de produção: build estático do web + reverse proxy para a API.
# Build context = raiz do monorepo.

# ---------- build do frontend ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm install
COPY . .
# Em produção o web fala com a API pelo mesmo domínio (paths /api e /socket.io)
ARG VITE_API_URL=/api
ARG VITE_SOCKET_URL=/
RUN npm run build --workspace @whats-boot/web

# ---------- runtime nginx ----------
FROM nginx:1.27-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80 443
