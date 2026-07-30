# ETAPA 8 — Chat (estilo WhatsApp Web)

Interface de atendimento em 3 painéis, tempo real via Socket.IO, tudo conectado
ao banco e isolado por tenant.

## Recursos

- **Lista lateral:** conversas com avatar, prévia da última mensagem, horário,
  badge de não lidas, fixadas no topo, etiquetas; **pesquisa** e abas
  **Ativas/Arquivadas**.
- **Conversa central:** cabeçalho com ações (**Fixar**, **Arquivar**,
  **Resolver**), balões entrada/saída, **status** (✓ enviado, ✓✓ entregue,
  ✓✓ azul lido, ⚠ falha), **scroll infinito** (carrega mensagens antigas ao
  rolar para cima), **emojis**, e renderização de **imagem, vídeo, áudio e
  documento (PDF)**.
- **Painel direito:** dados do contato, **etiquetas** (adicionar/criar/remover),
  **notas internas** (visíveis só para a equipe).
- **Tempo real:** novas mensagens, mudanças de status e atualizações de conversa
  chegam por WebSocket (`message.created`, `message.status`, `conversation.updated`).

## Endpoints (`/conversations`, `/tags`) — protegidos (auth + tenant + permissão)

| Método      | Rota                                  | Ação                          |
| ----------- | ------------------------------------- | ----------------------------- |
| GET         | `/conversations?q=&archived=&tagId=`  | Lista (pesquisa/filtros)      |
| GET         | `/conversations/:id`                  | Detalhe (contato + etiquetas) |
| GET         | `/conversations/:id/messages?cursor=` | Mensagens (scroll infinito)   |
| POST        | `/conversations/:id/messages`         | Envia mensagem                |
| POST        | `/conversations/:id/read`             | Marca como lida               |
| PATCH       | `/conversations/:id`                  | status / fixar / arquivar     |
| POST/DELETE | `/conversations/:id/tags[/:tagId]`    | Etiquetas na conversa         |
| GET/POST    | `/conversations/:id/notes`            | Notas internas                |
| GET/POST    | `/tags`                               | Listar/criar etiquetas        |

## ⚠️ Precisa aplicar o schema (campos novos)

Foram adicionados `isPinned`, `isArchived`, `archivedAt` em `Conversation`.
Depois de puxar o código, rode:

```bash
npm run db:push      # sincroniza o schema no banco
```

## Como testar (sem WhatsApp/Evolution)

```bash
npm run seed          # admin (se ainda não criou)
npm run seed:demo     # cria 2 conversas de exemplo com mensagens
npm run dev
```

Abra `http://localhost:5173` → menu **Chat**. Você verá as conversas de demo,
poderá enviar mensagens (elas persistem; o envio real ao WhatsApp só ocorre com
um canal Evolution conectado), fixar/arquivar/resolver, criar etiquetas e notas.

**Tempo real de verdade:** com um canal Evolution conectado (ETAPA 7), toda
mensagem recebida cai no webhook, é salva e aparece na conversa na hora.
