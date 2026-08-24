/**
 * Mutex em memória por chave (in-process).
 *
 * Serializa execuções que compartilham a mesma chave; chaves diferentes rodam
 * em paralelo. Uso principal: garantir UMA qualificação por conversa de cada
 * vez, evitando corrida quando o lead manda várias mensagens em sequência
 * (respostas duplicadas, `collected` sobrescrito, closer notificado 2x).
 *
 * Escopo: processo único (o deploy atual roda inline, sem Redis/worker). Se um
 * dia entrar Redis + múltiplos workers, esta trava vira um lock distribuído
 * (advisory lock no Postgres ou Redlock) — ver Patch B.
 */
const chains = new Map<string, Promise<unknown>>();

export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  // Encadeia a execução após o que já estiver rodando/pendente para esta chave.
  const prev = chains.get(key) ?? Promise.resolve();
  // O elo seguinte só começa depois do anterior terminar (sucesso OU erro).
  const run = prev.catch(() => undefined).then(fn);
  chains.set(key, run);
  try {
    return await run;
  } finally {
    // Se ninguém encadeou depois de nós, limpa a entrada para não vazar memória.
    if (chains.get(key) === run) chains.delete(key);
  }
}
