import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { FilesystemManager } from '@machinebridge/fs';
import type { CommandExecutor } from '../executor/index.js';
import type { FsOperation } from '@machinebridge/protocol';

export function registerFsRoutes(
  app: FastifyInstance,
  options: {
    fsManager: FilesystemManager;
    executor: CommandExecutor;
  },
): void {
  const { fsManager, executor } = options;

  function makeFsRoute(action: 'read' | 'write' | 'delete' | 'list' | 'mkdir' | 'move' | 'copy') {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query as Record<string, unknown>) || {};
      const body = (request.body as Record<string, unknown>) || {};
      const params = { ...query, ...body };

      try {
        const data = await fsManager.executeAction(action, params);
        return { ok: true, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: 'FS_OPERATION_FAILED', message });
      }
    };
  }

  app.get('/v1/fs/read', makeFsRoute('read'));
  app.post('/v1/fs/read', makeFsRoute('read'));
  app.post('/v1/fs/write', makeFsRoute('write'));
  app.post('/v1/fs/delete', makeFsRoute('delete'));
  app.delete('/v1/fs', makeFsRoute('delete'));
  app.get('/v1/fs/list', makeFsRoute('list'));
  app.post('/v1/fs/list', makeFsRoute('list'));
  app.post('/v1/fs/mkdir', makeFsRoute('mkdir'));
  app.post('/v1/fs/move', makeFsRoute('move'));
  app.post('/v1/fs/copy', makeFsRoute('copy'));

  app.post('/v1/fs/batch', async (request, reply) => {
    const body = (request.body as { operations?: FsOperation[]; stopOnError?: boolean }) || {};
    if (!Array.isArray(body.operations) || body.operations.length === 0) {
      return reply
        .code(400)
        .send({ error: 'INVALID_REQUEST', message: 'Missing operations array' });
    }
    try {
      const result = await fsManager.executeBatch(
        body.operations,
        body.stopOnError !== undefined ? Boolean(body.stopOnError) : true,
        (cmd, cwd, timeoutMs) => executor.executeCommand(cmd, cwd, timeoutMs),
      );
      return { ok: true, ...result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.code(400).send({ error: 'FS_BATCH_FAILED', message });
    }
  });
}
