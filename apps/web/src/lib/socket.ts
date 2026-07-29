import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3333';

/** Cliente Socket.IO único (infraestrutura — autenticação virá depois). */
export const socket: Socket = io(SOCKET_URL, {
  path: '/socket.io',
  autoConnect: true,
  withCredentials: true,
  transports: ['websocket'],
});

export { SOCKET_URL };
