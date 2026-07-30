import { Emitter } from '@socket.io/redis-emitter';
import { createRedisConnection, redisEnabled } from '../lib/redis';

/**
 * Emissor de eventos Socket.IO.
 * - Com Redis: publica no Redis; qualquer processo (API/worker) emite em tempo
 *   real via adapter Redis.
 * - Sem Redis (modo inline): emite direto pela instância local do Socket.IO,
 *   registrada por `setLocalIo`. Como o processamento roda no mesmo processo,
 *   os eventos chegam aos clientes normalmente.
 */
interface LocalIo {
  to(room: string): { emit(event: string, payload: unknown): void };
}

let emitter: Emitter | null = null;
let localIo: LocalIo | null = null;

/** Registrado pelo servidor Socket.IO na inicialização (usado no modo sem Redis). */
export function setLocalIo(io: LocalIo): void {
  localIo = io;
}

function getEmitter(): Emitter {
  if (!emitter) {
    emitter = new Emitter(createRedisConnection());
  }
  return emitter;
}

/** Emite um evento para todos os sockets de um tenant (de qualquer processo). */
export function broadcastToTenant(tenantId: string, event: string, payload: unknown): void {
  const room = `tenant:${tenantId}`;
  if (redisEnabled) {
    getEmitter().to(room).emit(event, payload);
  } else {
    localIo?.to(room).emit(event, payload);
  }
}
