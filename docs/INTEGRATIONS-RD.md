# Integração RD Station (novos leads → WhatsApp)

Quando um lead novo entra no RD Station, ele dispara um **webhook** para o
whats-boot, que envia automaticamente a **1ª mensagem** no WhatsApp e (opcional)
deixa o **robô SDR** assumir a qualificação.

```
Lead no RD Station → webhook → /api/integrations/rdstation/webhook/:token
   → extrai telefone/nome → dispara mensagem (Evolution) → SDR assume na resposta
```

## Configurar (menu Integrações)

1. **Ativar** a integração.
2. Copie a **URL do webhook** (contém um token único) e cole no RD Station:
   **Integrações → Webhooks → Novo webhook**, evento **"Lead convertido"**.
3. Escolha o **canal** (instância WhatsApp) e a **mensagem de abertura**
   (use `{{nome}}`).
4. Defina se, após a 1ª mensagem, o **SDR assume** (recomendado) ou fica para
   um humano.

## Como funciona

- A URL do webhook é **secreta** (token). "Gerar novo token" invalida a antiga.
- O telefone é normalizado para o padrão BR (DDI 55). O app tenta os campos
  `mobile_phone`, `personal_phone`, `phone`, `telefone`, `celular`.
- A mensagem cria a conversa/contato; quando o lead responde, o **agente de IA**
  (se em AUTOPILOT) conduz a pré-qualificação já existente.
- Se "SDR assume" estiver **desligado**, a IA da conversa é pausada
  (`aiEnabled=false`) e um humano continua.
- Cada lead recebido vira uma linha no **log** (RECEIVED/SENT/SKIPPED/FAILED)
  para diagnóstico.

## Endpoints

| Método | Rota                                         | Ação                          |
| ------ | -------------------------------------------- | ----------------------------- |
| GET    | `/api/integrations/rdstation`                | Config atual + URL            |
| PUT    | `/api/integrations/rdstation`                | Salvar config                 |
| POST   | `/api/integrations/rdstation/regenerate`     | Novo token                    |
| GET    | `/api/integrations/rdstation/events`         | Últimos leads recebidos       |
| POST   | `/api/integrations/rdstation/webhook/:token` | **Público** — o RD chama aqui |

## Modelo de dados

- `RdIntegration` (por tenant): enabled, webhookToken (único), channelId,
  openingMessage, handoffToSdr.
- `RdLeadEvent`: log de cada lead recebido.

> Boas práticas: dispare apenas para leads **opt-in** (que pediram contato) para
> evitar bloqueio do número no WhatsApp.
