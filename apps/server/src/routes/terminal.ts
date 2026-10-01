import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CommandExecutor } from '../executor/index.js';
import type { InMemorySessionStore } from '../sessions.js';
import type { PtyManager } from '@machinebridge/pty';
import type { Config } from '@machinebridge/config';
import type { TerminalSignal } from '@machinebridge/protocol';

export function registerTerminalRoutes(
  app: FastifyInstance,
  options: {
    executor: CommandExecutor;
    sessions: InMemorySessionStore;
    ptyManager: PtyManager;
    config: Config;
  },
): void {
  const { executor, sessions, ptyManager, config } = options;

  // Single Command Execution Handler
  async function handleExecute(request: FastifyRequest, reply: FastifyReply) {
    const query = (request.query as Record<string, unknown>) || {};
    const body = (request.body as Record<string, unknown>) || {};

    if (Array.isArray(body.commands) || Array.isArray(query.commands)) {
      return handleExecuteBatch(request, reply);
    }

    const command = (query.command as string) || (body.command as string);
    if (!command) {
      return reply
        .code(400)
        .send({ error: 'INVALID_REQUEST', message: 'Missing command parameter' });
    }

    const cwd = (query.cwd as string) || (body.cwd as string);
    const timeoutMs = Number(query.timeoutMs || body.timeoutMs || 15000);
    const shell = (query.shell as string) || (body.shell as string);
    const sessionId = (query.sessionId as string) || (body.sessionId as string);

    try {
      const result = await executor.executeCommand(command, cwd, timeoutMs, shell, sessionId);
      return { ok: true, command, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'EXECUTION_FAILED', message });
    }
  }

  // Batch Command Execution Handler
  async function handleExecuteBatch(request: FastifyRequest, reply: FastifyReply) {
    const query = (request.query as Record<string, unknown>) || {};
    const body = (request.body as Record<string, unknown>) || {};

    let rawCommands: unknown = body.commands ?? query.commands ?? body.command ?? query.command;
    if (typeof rawCommands === 'string') {
      try {
        const parsed = JSON.parse(rawCommands);
        if (Array.isArray(parsed)) rawCommands = parsed;
      } catch {
        // keep as is
      }
    }

    const commands: string[] = Array.isArray(rawCommands)
      ? rawCommands.map(String)
      : typeof rawCommands === 'string' && rawCommands
        ? [rawCommands]
        : [];

    if (commands.length === 0) {
      return reply
        .code(400)
        .send({ error: 'INVALID_REQUEST', message: 'Missing commands parameter' });
    }

    const cwd = (query.cwd as string) || (body.cwd as string);
    const timeoutMs = Number(query.timeoutMs || body.timeoutMs || 30000);
    const stopOnError =
      body.stopOnError !== undefined
        ? Boolean(body.stopOnError)
        : query.stopOnError !== undefined
          ? query.stopOnError === 'true' || query.stopOnError === true
          : true;
    const shell = (query.shell as string) || (body.shell as string);
    const sessionId = (query.sessionId as string) || (body.sessionId as string);

    try {
      const result = await executor.executeCommands(
        commands,
        cwd,
        timeoutMs,
        stopOnError,
        shell,
        sessionId,
      );
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: 'EXECUTION_FAILED', message });
    }
  }

  app.get('/v1/terminal/execute', handleExecute);
  app.post('/v1/terminal/execute', handleExecute);
  app.get('/v1/terminal/execute-batch', handleExecuteBatch);
  app.post('/v1/terminal/execute-batch', handleExecuteBatch);

  // Sessions Management
  app.post('/v1/terminal/sessions', async (_request, reply) => {
    if (sessions.activeCount >= config.MACHINEBRIDGE_MAX_SESSIONS) {
      return reply.code(429).send({ error: 'MAX_SESSIONS_REACHED' });
    }
    const session = sessions.create(config.MACHINEBRIDGE_SESSION_TTL_SECONDS);
    return {
      sessionId: session.id,
      expiresAt: session.expiresAt.toISOString(),
      websocketPath: `/v1/terminal/sessions/${session.id}`,
    };
  });

  app.get('/v1/terminal/sessions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    return {
      sessionId: session.id,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
    };
  });

  app.all('/v1/terminal/sessions/:id/input', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });

    const query = (request.query as Record<string, string>) || {};
    const body = (request.body as Record<string, string>) || {};
    const data = query.data || body.data;
    const signal = (query.signal || body.signal) as TerminalSignal | undefined;

    const ptySession = ptyManager.get(id);
    if (!ptySession) return reply.code(404).send({ error: 'PTY_NOT_RUNNING' });

    if (data) ptySession.write(data);
    if (signal) ptySession.signal(signal);

    return { ok: true, sessionId: id };
  });

  app.get('/v1/terminal/sessions/:id/output', async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
    return { ok: true, sessionId: id, output: sessions.getOutput(id) };
  });

  app.all('/v1/terminal/sessions/:id/close', async (request, _reply) => {
    const { id } = request.params as { id: string };
    ptyManager.close(id);
    sessions.setStatus(id, 'closed');
    return { ok: true, sessionId: id, status: 'closed' };
  });
}
