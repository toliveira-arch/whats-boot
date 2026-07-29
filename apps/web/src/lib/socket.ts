import { io, type Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3333';

let socket: Socket | null = null;

/** Conecta (ou reconecta) o socket autenticado com o access token atual. */
export function connectSocket(token: string): Socket {
  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    return socket;
  }
  socket = io(SOCKET_URL, {
    path: '/socket.io',
    autoConnect: true,
    withCredentials: true,
    transports: ['websocket'],
    auth: { token },
  });
  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

export { SOCKET_URL };
