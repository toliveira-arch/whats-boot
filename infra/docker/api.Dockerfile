# syntax=docker/dockerfile:1
# Build context = raiz do monorepo.

# ---------- base (deps + prisma client) ----------
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl
# DATABASE_URL fictícia só para o `prisma generate` durante o build
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
RUN npm install

COPY . .
RUN npm run db:generate

# ---------- dev ----------
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3333
CMD ["npm", "run", "dev:api"]

# ---------- build ----------
FROM base AS build
RUN npm run build --workspace @whats-boot/api

# ---------- prod ----------
FROM node:20-alpine AS prod
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages ./packages
EXPOSE 3333
# Healthcheck de liveness
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3333/health/live || exit 1
CMD ["node", "apps/api/dist/index.js"]
