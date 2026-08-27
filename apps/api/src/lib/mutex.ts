import { logger } from './logger';

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

/** Teto de execução de cada elo — a fila SEMPRE anda (ver comentário abaixo). */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Limita o tempo de UM elo da corrente.
 *
 * Sem isso, uma execução pendurada (provedor de IA sem resposta, consulta presa)
 * segurava para sempre todas as mensagens seguintes DAQUELA conversa — o robô
 * simplesmente parava de responder ali, sem erro nenhum no log. Com o teto, o
 * elo travado é abandonado (com log) e a próxima mensagem é atendida.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, key: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      logger.error({ key, ms }, 'mutex: execução excedeu o tempo limite — liberando a fila');
      reject(new Error(`withKeyedLock("${key}") excedeu ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err as Error);
      },
    );
  });
}

export async function withKeyedLock<T>(
  key: string,
  fn: () => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  // Encadeia a execução após o que já estiver rodando/pendente para esta chave.
  const prev = chains.get(key) ?? Promise.resolve();
  // O elo seguinte só começa depois do anterior terminar (sucesso, erro OU
  // estouro do tempo limite) — a corrente nunca fica presa indefinidamente.
  const run = prev.catch(() => undefined).then(() => withTimeout(fn(), timeoutMs, key));
  chains.set(key, run);
  try {
    return await run;
  } finally {
    // Se ninguém encadeou depois de nós, limpa a entrada para não vazar memória.
    if (chains.get(key) === run) chains.delete(key);
  }
}
