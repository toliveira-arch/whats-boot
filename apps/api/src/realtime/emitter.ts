import { Emitter } from '@socket.io/redis-emitter';
import { createRedisConnection } from '../lib/redis';

/**
 * Emissor de eventos Socket.IO independente do processo.
 * Publica no Redis; o servidor Socket.IO (com adapter Redis) entrega aos
 * clientes conectados. Assim os WORKERS conseguem emitir em tempo real.
 */
let emitter: Emitter | null = null;

function getEmitter(): Emitter {
  if (!emitter) {
    emitter = new Emitter(createRedisConnection());
  }
  return emitter;
}

/** Emite um evento para todos os sockets de um tenant (de qualquer processo). */
export function broadcastToTenant(tenantId: string, event: string, payload: unknown): void {
  getEmitter().to(`tenant:${tenantId}`).emit(event, payload);
}
