import type { FastifyInstance } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { decode, encode } from '@machinebridge/protocol';
import { verifyApiKey } from '@machinebridge/shared';
import type { PtyManager } from '@machinebridge/pty';
import type { InMemorySessionStore } from '../sessions.js';
import type { Config } from '@machinebridge/config';

export function setupTerminalWebSocket(
  app: FastifyInstance,
  options: {
    ptyManager: PtyManager;
    sessions: InMemorySessionStore;
    apiKey: string;
    config: Config;
  },
): WebSocketServer {
  const { ptyManager, sessions, apiKey, config } = options;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: config.MACHINEBRIDGE_MAX_MESSAGE_BYTES,
  });

  app.server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const prefix = '/v1/terminal/sessions/';

    if (!url.pathname.startsWith(prefix)) {
      socket.destroy();
      return;
    }

    const sessionId = url.pathname.slice(prefix.length).split('?')[0];
    if (!sessionId) {
      socket.destroy();
      return;
    }

    // Verify API Key
    const token =
      url.searchParams.get('token') ??
      url.searchParams.get('apiKey') ??
      req.headers['x-api-key'] ??
      req.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!verifyApiKey(apiKey, String(token || ''))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      let ptySession = ptyManager.get(sessionId);
      let session = sessions.get(sessionId);
      if (!session) {
        session = sessions.create();
      }

      ws.on('message', (raw) => {
        try {
          const message = decode(raw as Buffer);
          if (message.type === 'terminal.create') {
            if (!ptySession) {
              ptySession = ptyManager.create(
                {
                  id: sessionId,
                  cols: message.cols,
                  rows: message.rows,
                  shell: message.shell,
                  cwd: message.cwd,
                },
                {
                  onData: (data: string) => {
                    sessions.appendOutput(sessionId, data);
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(encode({ type: 'terminal.output', sessionId, data }));
                    }
                  },
                  onExit: () => {
                    sessions.setStatus(sessionId, 'closed');
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(encode({ type: 'terminal.closed', sessionId }));
                    }
                  },
                  onError: (err: Error) => {
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(encode({ type: 'error', code: 'PTY_ERROR', message: err.message }));
                    }
                  },
                },
              );
              sessions.setStatus(sessionId, 'running');
              ws.send(
                encode({
                  type: 'terminal.created',
                  requestId: message.requestId,
                  sessionId,
                  pid: ptySession.pid,
                }),
              );
            }
          } else if (message.type === 'terminal.input') {
            ptySession?.write(message.data);
          } else if (message.type === 'terminal.resize') {
            ptySession?.resize(message.cols, message.rows);
          } else if (message.type === 'terminal.signal') {
            ptySession?.signal(message.signal);
          } else if (message.type === 'terminal.close') {
            ptyManager.close(sessionId);
            sessions.setStatus(sessionId, 'closed');
            ws.close(1000, 'session closed');
          }
        } catch {
          ws.send(encode({ type: 'error', code: 'INVALID_MESSAGE', message: 'Malformed message' }));
        }
      });

      ws.on('close', () => {
        ptyManager.close(sessionId);
        sessions.setStatus(sessionId, 'closed');
      });
    });
  });

  return wss;
}
