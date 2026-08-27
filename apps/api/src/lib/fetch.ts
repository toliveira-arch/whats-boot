/**
 * `fetch` com TEMPO LIMITE explícito.
 *
 * Por que existe: o `fetch` do Node não tem timeout de ponta a ponta. Uma
 * chamada travada num provedor externo (LLM, transcrição) fica pendurada por
 * minutos. Como a geração da resposta é serializada POR CONVERSA (lib/mutex),
 * uma chamada travada deixa o robô MUDO nessa conversa durante todo o tempo em
 * que a requisição fica pendurada — o lead manda mensagem e ninguém responde.
 *
 * Com timeout, a falha vira erro rápido: cai no `catch` do chamador, vira log
 * (`provider-error`) e a próxima mensagem do lead tenta de novo.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${label}: tempo esgotado (${Math.round(timeoutMs / 1000)}s sem resposta)`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
