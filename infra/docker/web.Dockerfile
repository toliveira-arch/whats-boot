# syntax=docker/dockerfile:1
# Imagem de DESENVOLVIMENTO do frontend (Vite dev server).
# A imagem de PRODUÇÃO do web é construída pelo infra/nginx/Dockerfile
# (build estático servido pelo Nginx).

FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm install
COPY . .

FROM base AS dev
ENV NODE_ENV=development
EXPOSE 5173
CMD ["npm", "run", "dev:web"]
