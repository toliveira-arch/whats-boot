import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createRedisConnection } from '../lib/redis';
import { corsOrigins } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Servidor Socket.IO com adapter Redis (escala horizontal).
 * Infraestrutura apenas: um handler de conexão de exemplo, sem lógica de negócio.
 */
export function createSocketServer(httpServer: HttpServer): SocketServer {
  const io = new SocketServer(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    path: '/socket.io',
  });

  const pubClient = createRedisConnection();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  io.on('connection', (socket) => {
    logger.debug({ id: socket.id }, 'socket conectado');
    socket.emit('server:ready', { ts: Date.now() });

    socket.on('disconnect', (reason) => {
      logger.debug({ id: socket.id, reason }, 'socket desconectado');
    });
  });

  logger.info('socket.io inicializado (adapter redis)');
  return io;
}
