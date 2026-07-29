# ETAPA 6 — Dashboard

Dashboard com backend e frontend completos, cards, indicadores e tempo real via
Socket.IO. **Sem dados fake** — tudo vem de consultas reais ao banco, isoladas
por tenant.

## Backend

- `modules/dashboard/dashboard.service.ts` — `getMetrics()` calcula tudo com
  `prisma` (isolado por tenant): conversas por status, mensagens (total/24h/
  entrada/saída), contatos, canais conectados, atendentes online, tempo médio de
  1ª resposta e série de mensagens dos últimos 7 dias.
- `GET /dashboard/metrics` — protegida por `authenticate` + `tenantContext` +
  `requirePermissions('conversations.read')`.
- Tempo real: o socket responde a `dashboard:subscribe` emitindo
  `dashboard:metrics`; `emitDashboardMetrics(io, tenantId)` permite empurrar
  atualizações quando dados mudarem (usado pelos próximos módulos).

## Frontend

- **Auth no cliente:** `lib/auth.tsx` (login silencioso via refresh, contexto
  de sessão), `lib/api.ts` (Bearer + refresh automático no 401), `lib/socket.ts`
  (socket autenticado por token).
- **Rotas:** `/login` (público) e `/` (dashboard, protegido). `App.tsx` redireciona
  para `/login` quando não autenticado.
- **Dashboard:** cards de KPI, gráfico de 7 dias, indicador "ao vivo",
  atualização em tempo real ao receber `dashboard:metrics`.

## Validar (após subir a infra + migrar)

```bash
docker compose up -d postgres redis
npm run db:generate && npm run db:migrate -- --name init
npm run dev            # api :3333 + web :5173
```

1. Registre uma conta (`docs/AUTH.md`) e faça login em `http://localhost:5173`.
2. O dashboard carrega as métricas reais (zeradas no início — ainda não há
   conversas/mensagens; elas aparecem a partir da ETAPA 7/8).
3. A badge "ao vivo" confirma o WebSocket; `dashboard:subscribe` traz os números
   do banco em tempo real.
