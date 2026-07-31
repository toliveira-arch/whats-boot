# Pré-qualificação de leads (SDR)

O robô conduz um **roteiro de qualificação** humanizado, extrai os dados da
conversa e decide — de forma **determinística** — se o lead é MQL.

## Como funciona

1. **Detecção de campanha** — a IA classifica (+ palavras-gatilho como reforço).
2. **Roteiro** — o bot pergunta UMA coisa por vez (decisor → faturamento → ramo
   → CNPJ → dor, editável), de forma natural.
3. **Extração** — a IA devolve um JSON com os dados coletados (`structured
output`), acumulados na conversa.
4. **Gate (no código, não no modelo)** — quando o roteiro está completo, avalia:
   piso de faturamento, exige decisor?, exige CNPJ?, ramos aceitos/excluídos.
5. **Decisão**:
   - **Qualificado (MQL)** → envia a mensagem de encaminhamento; se configurado,
     **pausa a IA** (`aiEnabled=false`), marca a conversa como `PENDING` e emite
     `lead.updated` para o atendente assumir.
   - **Não qualificado** → **dispensa cordial** (mensagem configurável, **sem
     expor o critério**).
   - **Em andamento** → segue perguntando.

## Onde configurar

**IA → Pré-qualificação de leads (SDR)**:

- Ativar · Detecção (IA+gatilhos / só gatilhos) · Ação ao qualificar (pausar+atribuir / só marcar)
- **Piso de faturamento padrão** e mensagens padrão (dispensa / encaminhamento)
- **Roteiro padrão** (com botão "Usar roteiro SDR sugerido")
- **Campanhas**: nome, gatilhos, descrição, piso próprio, exige decisor/CNPJ,
  ramos aceitos/excluídos, mensagens próprias e roteiro próprio (opcional).

## Resultado (ficha do lead)

No **Chat → painel do contato** aparece a **Qualificação**: veredito
(Qualificado / Não qualificado / Em qualificação), campanha, interesse/urgência,
dados coletados e resumo. Atualiza em tempo real (`lead.updated`).

## Modelo de dados

- `AiAgent.qualification` (JSON) — toda a config acima.
- `Conversation.leadVerdict` (`IN_PROGRESS|QUALIFIED|DISQUALIFIED`) e
  `Conversation.qualification` (JSON: campanha, dados coletados, interesse,
  urgência, resumo, motivos internos).

> Funciona em **AUTOPILOT** (o bot conduz e age). Em COPILOT, apenas sugere a
> próxima pergunta ao atendente.
