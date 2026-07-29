import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type DefaultEventsMap, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { runWithTenant } from '@whats-boot/database';
import { createRedisConnection } from '../lib/redis';
import { corsOrigins } from '../config/env';
import { logger } from '../lib/logger';
import { verifyAccessToken, type AuthContext } from '../modules/auth/tokens';

/** Dados anexados a cada socket autenticado. */
export interface SocketData {
  auth: AuthContext;
}

export type AppSocketServer = SocketServer<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

type AppSocket = Socket<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, SocketData>;

function extractToken(socket: AppSocket): string | undefined {
  const fromAuth = socket.handshake.auth?.token as string | undefined;
  if (fromAuth) return fromAuth;
  const header = socket.handshake.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return undefined;
}

/**
 * Servidor Socket.IO com:
 *  - autenticação por JWT no handshake;
 *  - isolamento por tenant (rooms `tenant:{id}` + contexto no banco);
 *  - adapter Redis para escala horizontal.
 */
export function createSocketServer(httpServer: HttpServer): AppSocketServer {
  const io: AppSocketServer = new SocketServer(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    path: '/socket.io',
  });

  const pubClient = createRedisConnection();
  const subClient = pubClient.duplicate();
  io.adapter(createAdapter(pubClient, subClient));

  // Autenticação obrigatória no handshake.
  io.use((socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    try {
      const payload = verifyAccessToken(token);
      socket.data.auth = {
        userId: payload.sub,
        tenantId: payload.tid,
        membershipId: payload.mid,
        role: payload.role,
        permissions: payload.perms ?? [],
      };
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { tenantId, userId } = socket.data.auth;

    // Isolamento: cada socket só recebe eventos do seu tenant.
    socket.join(`tenant:${tenantId}`);
    socket.join(`user:${userId}`);

    logger.debug({ id: socket.id, tenantId, userId }, 'socket conectado');
    socket.emit('server:ready', { tenantId, ts: Date.now() });

    socket.on('disconnect', (reason) => {
      logger.debug({ id: socket.id, reason }, 'socket desconectado');
    });
  });

  logger.info('socket.io inicializado (auth + isolamento por tenant + adapter redis)');
  return io;
}

/** Emite um evento para todos os sockets de um tenant. */
export function emitToTenant(
  io: AppSocketServer,
  tenantId: string,
  event: string,
  payload: unknown,
): void {
  io.to(`tenant:${tenantId}`).emit(event, payload);
}

/** Executa um handler de socket dentro do contexto de tenant do socket. */
export function withSocketTenant<T>(socket: AppSocket, fn: () => T): T {
  return runWithTenant(socket.data.auth.tenantId, fn);
}
