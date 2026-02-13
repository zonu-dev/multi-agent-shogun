import { request as httpRequest, type IncomingMessage, type Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { API_AUTH_TOKEN } from '../config/constants';
import { logger } from '../lib/logger';
import type { WSEventType, WSMessage } from '../types';

interface QueuedBroadcastMessage {
  type: WSEventType;
  payload: unknown;
  sequence: number;
}

interface ClientSyncState {
  initialStateSent: boolean;
  pending: QueuedBroadcastMessage[];
}

interface BroadcastBatchState {
  queue: QueuedBroadcastMessage[];
  timer: NodeJS.Timeout | null;
  nextSequence: number;
  clientSyncStateBySocket: WeakMap<WebSocket, ClientSyncState>;
}

const broadcastBatchByServer = new WeakMap<WebSocketServer, BroadcastBatchState>();
const BROADCAST_BATCH_WINDOW_MS = 50;
const WS_AUTH_TOKEN_PARAM = 'token';

function parseRequestToken(rawUrl: string | undefined): string | null {
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return null;
  }

  try {
    const parsedUrl = new URL(rawUrl, 'http://localhost');
    const token = parsedUrl.searchParams.get(WS_AUTH_TOKEN_PARAM);
    if (token === null) {
      return null;
    }

    const normalized = token.trim();
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function disconnectClient(client: WebSocket): void {
  if (client.readyState === WebSocket.CLOSED) {
    return;
  }

  try {
    client.terminate();
  } catch {
    // Ignore termination errors from already-closed sockets.
  }
}

function getBroadcastBatchState(wss: WebSocketServer): BroadcastBatchState {
  const existing = broadcastBatchByServer.get(wss);
  if (existing !== undefined) {
    return existing;
  }

  const created: BroadcastBatchState = {
    queue: [],
    timer: null,
    nextSequence: 0,
    clientSyncStateBySocket: new WeakMap<WebSocket, ClientSyncState>(),
  };
  broadcastBatchByServer.set(wss, created);
  return created;
}

function getClientSyncState(state: BroadcastBatchState, client: WebSocket): ClientSyncState {
  const existing = state.clientSyncStateBySocket.get(client);
  if (existing !== undefined) {
    return existing;
  }

  const created: ClientSyncState = {
    initialStateSent: true,
    pending: [],
  };
  state.clientSyncStateBySocket.set(client, created);
  return created;
}

function setClientInitialStatePending(state: BroadcastBatchState, client: WebSocket): void {
  state.clientSyncStateBySocket.set(client, {
    initialStateSent: false,
    pending: [],
  });
}

function clearClientSyncState(state: BroadcastBatchState, client: WebSocket): void {
  state.clientSyncStateBySocket.delete(client);
}

function sendQueuedMessage(client: WebSocket, message: QueuedBroadcastMessage): void {
  sendWsMessage(client, message.type, message.payload, {
    sequence: message.sequence,
  });
}

function flushPendingClientMessages(state: BroadcastBatchState, client: WebSocket): void {
  const clientState = getClientSyncState(state, client);
  if (!clientState.initialStateSent || clientState.pending.length === 0) {
    return;
  }

  const pendingMessages = clientState.pending;
  clientState.pending = [];

  for (const message of pendingMessages) {
    sendQueuedMessage(client, message);
  }
}

function markClientInitialStateSent(state: BroadcastBatchState, client: WebSocket): void {
  const clientState = getClientSyncState(state, client);
  clientState.initialStateSent = true;
  flushPendingClientMessages(state, client);
}

function enqueueOrSendBroadcastMessage(
  state: BroadcastBatchState,
  client: WebSocket,
  message: QueuedBroadcastMessage
): void {
  const clientState = getClientSyncState(state, client);
  if (!clientState.initialStateSent) {
    clientState.pending.push(message);
    return;
  }

  sendQueuedMessage(client, message);
}

function flushBroadcastQueue(wss: WebSocketServer): void {
  const state = getBroadcastBatchState(wss);
  state.timer = null;

  if (state.queue.length === 0 || wss.clients.size === 0) {
    state.queue = [];
    return;
  }

  const pendingMessages = state.queue;
  state.queue = [];

  for (const client of wss.clients) {
    for (const message of pendingMessages) {
      enqueueOrSendBroadcastMessage(state, client, message);
    }
  }
}

export function createWebSocketServer(): WebSocketServer {
  return new WebSocketServer({ noServer: true });
}

export function sendWsMessage<T>(
  client: WebSocket,
  type: WSEventType,
  payload: T,
  options?: {
    sequence?: number;
  }
): void {
  if (client.readyState !== WebSocket.OPEN) {
    return;
  }

  const body: WSMessage<T> & { sequence?: number } = {
    type,
    payload,
  };
  if (typeof options?.sequence === 'number' && Number.isFinite(options.sequence)) {
    body.sequence = options.sequence;
  }

  let serializedBody = '';
  try {
    serializedBody = JSON.stringify(body);
    client.send(serializedBody, (error) => {
      if (error == null) {
        return;
      }

      logger.error('[ws] failed to send message', {
        error,
      });
      disconnectClient(client);
    });
  } catch (error) {
    logger.error('[ws] failed to send message', {
      error,
    });
    disconnectClient(client);
  }
}

export function broadcastWsMessage<T>(wss: WebSocketServer, type: WSEventType, payload: T): void {
  const state = getBroadcastBatchState(wss);
  state.nextSequence += 1;
  state.queue.push({
    type,
    payload,
    sequence: state.nextSequence,
  });

  if (state.timer !== null) {
    return;
  }

  state.timer = setTimeout(() => {
    flushBroadcastQueue(wss);
  }, BROADCAST_BATCH_WINDOW_MS);
}

function writeProxyHeaders(
  statusCode: number,
  statusMessage: string,
  headers: NodeJS.Dict<string | string[]>
): string {
  const lines: string[] = [`HTTP/1.1 ${statusCode} ${statusMessage}`];

  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        lines.push(`${name}: ${item}`);
      }
      continue;
    }

    lines.push(`${name}: ${value}`);
  }

  return `${lines.join('\r\n')}\r\n\r\n`;
}

function isIgnorableSocketError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EPIPE' || code === 'ECONNRESET';
}

function destroySocketSafe(socket: Duplex): void {
  if (socket.destroyed) {
    return;
  }

  try {
    socket.destroy();
  } catch {
    // Ignore teardown errors from already-closing sockets.
  }
}

function writeSocketSafe(socket: Duplex, chunk: string | Buffer): boolean {
  if (socket.destroyed || !socket.writable) {
    return false;
  }

  try {
    socket.write(chunk);
    return true;
  } catch (error) {
    if (!isIgnorableSocketError(error)) {
      logger.error('[ws] websocket proxy write failed', {
        error,
      });
    }
    destroySocketSafe(socket);
    return false;
  }
}

function proxyUpgradeToVite(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  options: {
    host: string;
    port: number;
  }
): void {
  const proxyReq = httpRequest({
    hostname: options.host,
    port: options.port,
    method: req.method ?? 'GET',
    path: req.url ?? '/',
    headers: req.headers,
  });

  let tunnelSocket: Duplex | null = null;
  let cleanedUp = false;
  const cleanup = (): void => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    if (!proxyReq.destroyed) {
      proxyReq.destroy();
    }
    if (tunnelSocket !== null) {
      destroySocketSafe(tunnelSocket);
      tunnelSocket = null;
    }
    destroySocketSafe(socket);
  };

  socket.once('error', (error) => {
    if (!isIgnorableSocketError(error)) {
      logger.error('[ws] websocket client socket error', {
        error,
      });
    }
    cleanup();
  });
  socket.once('close', () => {
    cleanup();
  });

  proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
    tunnelSocket = proxySocket;
    proxySocket.once('error', (error) => {
      if (!isIgnorableSocketError(error)) {
        logger.error('[ws] websocket upstream socket error', {
          error,
        });
      }
      cleanup();
    });
    proxySocket.once('close', () => {
      cleanup();
    });

    const rawHeaders = writeProxyHeaders(
      proxyRes.statusCode ?? 101,
      proxyRes.statusMessage ?? 'Switching Protocols',
      proxyRes.headers
    );
    if (!writeSocketSafe(socket, rawHeaders)) {
      cleanup();
      return;
    }

    if (head.length > 0) {
      if (!writeSocketSafe(proxySocket, head)) {
        cleanup();
        return;
      }
    }
    if (proxyHead.length > 0) {
      if (!writeSocketSafe(socket, proxyHead)) {
        cleanup();
        return;
      }
    }

    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });

  proxyReq.on('response', (proxyRes) => {
    const rawHeaders = writeProxyHeaders(
      proxyRes.statusCode ?? 502,
      proxyRes.statusMessage ?? 'Bad Gateway',
      proxyRes.headers
    );
    if (!writeSocketSafe(socket, rawHeaders)) {
      proxyRes.destroy();
      cleanup();
      return;
    }
    proxyRes.once('error', (error) => {
      if (!isIgnorableSocketError(error)) {
        logger.error('[ws] websocket proxy upstream response error', {
          error,
        });
      }
      cleanup();
    });
    proxyRes.pipe(socket);
  });

  proxyReq.on('error', (error) => {
    if (!isIgnorableSocketError(error)) {
      logger.error('[ws] websocket proxy request error', {
        error,
      });
    }

    if (tunnelSocket === null && !socket.destroyed) {
      writeSocketSafe(socket, 'HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    }
    cleanup();
  });

  proxyReq.end();
}

export function registerWebSocketHandlers(options: {
  httpServer: HttpServer;
  wss: WebSocketServer;
  getInitialStateCached: () => Promise<unknown>;
  isAllowedWsOrigin: (origin: string | undefined) => boolean;
  viteDevHost: string;
  viteDevPort: number;
}): void {
  const { httpServer, wss, getInitialStateCached, isAllowedWsOrigin, viteDevHost, viteDevPort } =
    options;

  wss.on('connection', (socket) => {
    const broadcastState = getBroadcastBatchState(wss);
    const initialStateSequence = broadcastState.nextSequence;
    setClientInitialStatePending(broadcastState, socket);

    void (async () => {
      try {
        const initialState = await getInitialStateCached();
        sendWsMessage(socket, 'initial_state', initialState, {
          sequence: initialStateSequence,
        });
      } catch (error) {
        logger.error('[ws] failed to resolve initial_state', {
          error,
        });
        sendWsMessage(socket, 'ws_error', {
          code: 'initial_state_failed',
          message: 'Failed to load initial websocket state.',
          recoverable: true,
        });
      } finally {
        markClientInitialStateSent(broadcastState, socket);
      }
    })();

    socket.on('error', (error) => {
      logger.error('[ws] client error', {
        error,
      });
    });
    socket.on('close', () => {
      clearClientSyncState(broadcastState, socket);
    });
  });

  httpServer.on('upgrade', (req, socket, head) => {
    if (req.url?.startsWith('/ws')) {
      const requestOrigin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      if (!isAllowedWsOrigin(requestOrigin)) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }

      if (API_AUTH_TOKEN !== null) {
        const requestToken = parseRequestToken(req.url);
        if (requestToken === null || requestToken !== API_AUTH_TOKEN) {
          socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
      return;
    }

    proxyUpgradeToVite(req, socket, head, {
      host: viteDevHost,
      port: viteDevPort,
    });
  });
}
