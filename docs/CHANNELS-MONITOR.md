# Canais (Evolution API), Monitoramento e Toggle de IA

Painel de gestão das instâncias Evolution por empresa, monitoramento em tempo
real e controle do robô de IA por instância e por conversa. **Isolamento total
por tenant** — a extensão multi-tenant do Prisma injeta `tenantId` em todas as
consultas, então cada cliente só enxerga suas próprias instâncias, conversas,
mensagens e configurações.

## Painel de Canais (`/channels`)

Cada empresa administra suas próprias instâncias:

- **Cadastrar** instância (empresa, nome, `instanceName`, URL da Evolution,
  API key, número opcional).
- **Testar conexão** antes de salvar (`POST /channels/test`).
- **Gerar / reexibir QR Code** em modal, com atualização ao vivo via socket
  (`channel.qrcode`).
- **Reconectar** (restart), **Desconectar** (logout) e **Excluir** (soft delete
  - remoção best-effort na Evolution).
- **Status em tempo real** por badge (Criada / Aguardando QR / Conectando /
  Conectada / Desconectada / Falha), atualizado por `channel.status`.
- **Robô de IA on/off por instância** (toggle) — `PATCH /channels/:id/ai`.

## Monitoramento (`/monitor`)

- Contadores: total de instâncias, conectadas, com IA ligada.
- Tabela de todas as instâncias com status ao vivo.
- **Feed de atividade em tempo real**: mensagens recebidas/enviadas e mudanças
  de status de conexão, via Socket.IO (`message.created`, `channel.status`).

## Tempo real (Socket.IO + Evolution)

Webhooks da Evolution → fila → worker (`ingest.service`) grava no banco e emite
para a sala do tenant:

| Evento                 | Emitido em                       |
| ---------------------- | -------------------------------- |
| `message.created`      | mensagem recebida/enviada        |
| `message.status`       | ACK (enviada/entregue/lida)      |
| `conversation.updated` | qualquer mudança na conversa     |
| `channel.status`       | conexão da instância mudou       |
| `channel.qrcode`       | novo QR disponível               |
| `channel.ai`           | IA da instância ligada/desligada |
| `ai.suggestion`        | sugestão do copiloto             |

Tudo é persistido no PostgreSQL antes de emitir — nada fica só em memória.

## Toggle de IA — precedência

O robô só responde quando **todos** os níveis permitem. A decisão fica
centralizada em `ai.service.generateReply`:

1. **Instância** (`EvolutionInstance.aiEnabled`) — se `false`, nem enfileira o
   job (`ingest.service`).
2. **Conversa** (`Conversation.aiEnabled`) — `false` desliga só naquela conversa;
   `null` herda; `true` força ligado.
3. **Modo efetivo** — `Conversation.aiMode` sobrescreve o modo global do agente
   quando diferente de `OFF`; senão usa `AiAgent.mode`.
4. **Agente** — precisa estar ativo, dentro do horário e do limite de mensagens.

Controles: por instância no `/channels`; por conversa no painel de contato do
`/chat` (ligar/desligar + modo Copiloto/Autopilot).

## Persistência da configuração de IA

`GET /ai/agent` recarrega a config salva ao abrir a tela; `PUT /ai/agent` grava
no `AiAgent` do tenant. Após salvar, atualizar a página mantém tudo (lido do
banco no `useEffect`).

## Endpoints novos

| Método | Rota                 | Ação                                 |
| ------ | -------------------- | ------------------------------------ |
| GET    | `/companies`         | Empresas do tenant (para o cadastro) |
| PATCH  | `/channels/:id/ai`   | Liga/desliga IA da instância         |
| PATCH  | `/conversations/:id` | agora aceita `aiMode` e `aiEnabled`  |

## Migração

Campos novos: `EvolutionInstance.aiEnabled` (default `true`) e
`Conversation.aiEnabled` (`Boolean?`). Rode **`npm run db:push`** após o pull.
