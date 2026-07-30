# whats-boot

SaaS de atendimento via WhatsApp com IA — **monorepo** (Express + React/Vite + Prisma).

> **Estado atual:** ETAPA 3 concluída — infraestrutura (sem funcionalidades).
> A arquitetura completa está em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
> O andaime da Sprint 1 (n8n/Supabase/Next.js) foi movido para
> `infra/legacy-sprint1/`.

## Estrutura

```
whats-boot/
├── apps/
│   ├── api/            # Backend Express + TS (HTTP, Socket.IO, BullMQ, health)
│   └── web/            # Frontend React + Vite + TS
├── packages/
│   └── database/       # Prisma (schema + client compartilhado)
├── infra/
│   ├── docker/         # Dockerfiles (api dev/build/prod, web dev)
│   ├── nginx/          # Dockerfile + reverse proxy (prod)
│   ├── compose/        # docker-compose.prod.yml
│   └── legacy-sprint1/ # andaime da Sprint 1 (referência)
├── .github/workflows/  # CI (lint, format, typecheck, build, prisma)
├── docker-compose.yml  # ambiente de desenvolvimento
└── docs/               # ARCHITECTURE.md, SETUP.md
```

## Stack

| Camada    | Tecnologia                                           |
| --------- | ---------------------------------------------------- |
| Backend   | Node + Express + TypeScript                          |
| Realtime  | Socket.IO (+ Redis adapter)                          |
| Filas     | BullMQ (sobre Redis)                                 |
| Frontend  | React + Vite + TypeScript                            |
| ORM/Banco | Prisma + PostgreSQL 16 (pgvector)                    |
| Cache     | Redis 7                                              |
| Infra     | Docker, Docker Compose, Nginx                        |
| Qualidade | ESLint, Prettier, Husky, lint-staged, GitHub Actions |

## Desenvolvimento

### Com Docker (recomendado)

```bash
cp .env.example .env
docker compose up -d          # postgres, redis, api, web
docker compose logs -f api web
# API:  http://localhost:3333
# Web:  http://localhost:5173
```

### Local (sem Docker) — sequência recomendada

Um único `.env` na raiz abastece tudo (a API procura o `.env` subindo até a raiz;
os scripts de banco leem o mesmo `.env`).

```bash
cp .env.example .env          # já vem com hosts localhost p/ dev local
npm install                   # instala + gera o Prisma Client (via prepare)
docker compose up -d postgres redis   # sobe só o banco e o cache
npm run db:migrate -- --name init     # cria as tabelas
npm run seed                  # cria admin (admin@whatsboot.dev / Admin123)
npm run dev                   # api :3333 + web :5173
```

Confirme que a API subiu: `curl http://localhost:3333/health/ready`.

## Scripts (raiz)

| Script                | O que faz                     |
| --------------------- | ----------------------------- |
| `npm run dev`         | api + web em paralelo         |
| `npm run build`       | build de todos os workspaces  |
| `npm run typecheck`   | TypeScript em api e web       |
| `npm run lint`        | ESLint no monorepo            |
| `npm run format`      | Prettier (escrita)            |
| `npm run db:generate` | Prisma generate               |
| `npm run db:migrate`  | Prisma migrate dev            |
| `npm run seed`        | Cria usuário admin de exemplo |

## Health checks

- `GET /health` — liveness básico
- `GET /health/live` — liveness
- `GET /health/ready` — readiness (checa PostgreSQL + Redis)

## Produção

```bash
docker compose -f infra/compose/docker-compose.prod.yml --env-file .env up -d --build
# Nginx serve o web estático e faz proxy de /api e /socket.io para a API.
```
