# ETAPA 4 — Autenticação

Autenticação completa no backend Express: JWT (access) + refresh token rotativo
(cookie httpOnly), bcrypt, RBAC, guards, rate limit, recuperação/reset de senha.

## Endpoints (`/auth`)

| Método | Rota                    | Proteção             | Descrição                                         |
| ------ | ----------------------- | -------------------- | ------------------------------------------------- |
| POST   | `/auth/register`        | rate limit           | Cria usuário + tenant + papéis + membership admin |
| POST   | `/auth/login`           | rate limit           | Autentica e emite access + refresh (cookie)       |
| POST   | `/auth/refresh`         | cookie               | Rotaciona o refresh e emite novo access           |
| POST   | `/auth/logout`          | cookie               | Revoga o refresh atual e limpa o cookie           |
| POST   | `/auth/forgot-password` | rate limit           | Gera token de reset (entrega por e-mail depois)   |
| POST   | `/auth/reset-password`  | rate limit           | Redefine a senha e invalida todas as sessões      |
| GET    | `/auth/me`              | Bearer               | Perfil + tenant + papel + permissões              |
| GET    | `/auth/admin/ping`      | Bearer + papel ADMIN | Exemplo de rota protegida por RBAC                |

## Tokens

- **Access token (JWT):** `Authorization: Bearer <token>`, expira em `JWT_ACCESS_TTL`
  (padrão 15m). Payload: `{ sub, tid, mid, role, perms }`.
- **Refresh token:** opaco, persistido com hash SHA-256 (`RefreshToken`), enviado em
  cookie **httpOnly + SameSite=Lax** (`Secure` em produção). Rotação a cada uso com
  **detecção de reuso** (revoga a família inteira se um token revogado for reapresentado).

## RBAC — papéis e permissões

Papéis criados por tenant no registro (`seedTenantRoles`):

| Papel (key)                  | Permissões (resumo)                                                   |
| ---------------------------- | --------------------------------------------------------------------- |
| **Administrador** (`admin`)  | todas                                                                 |
| **Cliente** (`client`)       | leitura geral + `settings.manage`, `billing.manage`, `reports.read`   |
| **Funcionário** (`employee`) | operação: `conversations.*`, `contacts.*`, `channels.read`, `ai.read` |

Guards disponíveis (para os próximos módulos):

```ts
authenticate; // exige access token válido -> req.auth
requireRoles('admin'); // exige papel
requirePermissions('conversations.write'); // exige permissão(ões)
```

## Testar o fluxo (após subir Postgres + Redis)

```bash
# 0. Suba a infra e migre o banco
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate -- --name init   # cria as tabelas
# aplique RLS/pgvector: psql "$DATABASE_URL" -f packages/database/prisma/sql/0001_rls_and_vector.sql
npm run dev:api

# 1. Registrar
curl -i -X POST http://localhost:3333/auth/register \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"name":"Ana","email":"ana@ex.com","password":"Senha123","companyName":"AG Moonflag"}'

# 2. Login (guarda o cookie de refresh em cookies.txt)
curl -i -X POST http://localhost:3333/auth/login \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"email":"ana@ex.com","password":"Senha123"}'
# -> copie o accessToken da resposta

# 3. Rota protegida
curl http://localhost:3333/auth/me -H "Authorization: Bearer <ACCESS_TOKEN>"

# 4. Refresh (usa o cookie)
curl -i -X POST http://localhost:3333/auth/refresh -b cookies.txt -c cookies.txt

# 5. Reset de senha (dev retorna o token em `devToken`)
curl -X POST http://localhost:3333/auth/forgot-password \
  -H 'Content-Type: application/json' -d '{"email":"ana@ex.com"}'
curl -X POST http://localhost:3333/auth/reset-password \
  -H 'Content-Type: application/json' \
  -d '{"token":"<DEV_TOKEN>","password":"NovaSenha123"}'

# 6. Logout
curl -i -X POST http://localhost:3333/auth/logout -b cookies.txt
```

## Validação e segurança

- Entrada validada com **zod** (`422` com detalhes em erro).
- Senha forte exigida (mín. 8, maiúscula, minúscula, número).
- **Rate limit estrito** (10/min por IP) em login, register, forgot e reset.
- Mensagens genéricas em login/forgot para evitar enumeração de usuários.
- Senhas com **bcrypt** (12 rounds). Reset invalida todas as sessões.
