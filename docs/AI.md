# ETAPA 9 — IA (OpenAI + Gemini, desacoplada)

Camada de IA com provedor plugável e configuração por empresa (tenant), tudo
salvo no banco. **Sem acoplamento**: o domínio fala só com a interface
`LlmProvider`.

## Camada AI Provider

`apps/api/src/modules/ai/providers/`:

- `types.ts` — interface única `LlmProvider.chat(req, apiKey, baseUrl?)`.
- `openai.ts` — OpenAI (Chat Completions).
- `gemini.ts` — Google Gemini (generateContent).
- `index.ts` — registry `getProvider(name)`. Adicionar provedor = implementar a
  interface e registrar aqui.

## Configuração por empresa (modelo `AiAgent`)

Salvo no banco e editável em **/ai** (menu IA):

| Campo                                       | Descrição                                     |
| ------------------------------------------- | --------------------------------------------- |
| `provider` / `model`                        | OpenAI ou Gemini + modelo                     |
| `temperature` / `maxTokens`                 | parâmetros de geração                         |
| `mode`                                      | OFF · COPILOT (sugere) · AUTOPILOT (responde) |
| `systemPrompt`                              | instruções do agente                          |
| `requiredWords` / `forbiddenWords`          | palavras obrigatórias / proibidas             |
| `activeFrom` / `activeTo`                   | horário de funcionamento                      |
| `maxMessagesPerConversation`                | limite de respostas automáticas por conversa  |
| `minResponseSeconds` / `maxResponseSeconds` | atraso mín/máx antes de responder             |
| `isActive`                                  | liga/desliga                                  |

Credenciais (`AiCredential`) por provedor são **criptografadas** (AES-256-GCM).

## Fluxo

```
Mensagem recebida (webhook Evolution) → salva → fila ai.process
  → worker: generateReply(conversationId)
     · valida guardrails (ativo? modo? horário? limite de mensagens?)
     · monta contexto (systemPrompt + palavras + histórico) → provedor
     · filtra palavras proibidas na saída · registra uso (AiUsageLog)
     · aplica atraso configurado
     · AUTOPILOT → envia via Evolution (autor = IA)
       COPILOT  → emite `ai.suggestion` (aparece no chat para o atendente usar)
```

## Endpoints (`/ai`) — protegidos (permissão ai.read / ai.manage)

| Método | Rota              | Ação                                  |
| ------ | ----------------- | ------------------------------------- |
| GET    | `/ai/agent`       | Config atual                          |
| PUT    | `/ai/agent`       | Salvar config                         |
| GET    | `/ai/credentials` | Provedores + credenciais (mascaradas) |
| PUT    | `/ai/credentials` | Salvar API key de um provedor         |
| POST   | `/ai/test`        | Gerar resposta de teste               |

## Como testar

1. `npm run db:push` (o `AiAgent` ganhou campos novos).
2. Em **/ai**: escolha provedor (OpenAI/Gemini), cole a **API key**, defina
   modelo/prompt/modo e salve. Use **Testar** para validar a credencial.
3. Em **AUTOPILOT**, toda mensagem recebida gera resposta automática; em
   **COPILOT**, a sugestão aparece no chat com botão **Usar**.

> As chamadas são **reais** aos provedores — requer uma API key válida de OpenAI
> ou Google (Gemini). Sem key, `generateReply` apenas registra e não responde.
