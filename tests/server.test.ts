import Fastify from 'fastify';
import { PtyManager } from '@machinebridge/pty';
import { FilesystemManager } from '@machinebridge/fs';
import { InMemorySessionStore } from '../apps/server/src/sessions.js';
import { CommandExecutor } from '../apps/server/src/executor.js';
import { makeAuthHook } from '../apps/server/src/auth.js';
import { createMcpServer, MCP_TOOLS } from '../apps/server/src/mcp.js';

describe('Unified Server Components', () => {
  const testApiKey = 'test-secret-key-12345';
  const ptyManager = new PtyManager(5, 1024 * 1024);
  const fsManager = new FilesystemManager();
  const sessions = new InMemorySessionStore();
  const executor = new CommandExecutor(ptyManager);

  afterAll(() => {
    ptyManager.closeAll();
  });

  describe('Auth Hook', () => {
    let app: ReturnType<typeof Fastify>;

    beforeAll(async () => {
      app = Fastify();
      app.addHook('onRequest', makeAuthHook(testApiKey));
      app.get('/health', async () => ({ ok: true }));
      app.get('/protected', async () => ({ protected: true }));
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it('allows access to unauthenticated /health endpoint', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ ok: true });
    });

    it('rejects access to protected endpoint without API key', async () => {
      const res = await app.inject({ method: 'GET', url: '/protected' });
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.body).error).toBe('UNAUTHORIZED');
    });

    it('rejects access with invalid API key', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { 'x-api-key': 'wrong-key' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('allows access with valid x-api-key header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { 'x-api-key': testApiKey },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ protected: true });
    });

    it('allows access with valid Authorization Bearer header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${testApiKey}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ protected: true });
    });
  });

  describe('In-Memory Session Store', () => {
    it('creates, retrieves, and updates sessions without database', () => {
      const store = new InMemorySessionStore();
      const session = store.create(60);
      expect(session.id).toBeDefined();
      expect(session.status).toBe('starting');

      store.setStatus(session.id, 'running');
      expect(store.get(session.id)?.status).toBe('running');

      store.appendOutput(session.id, 'hello ');
      store.appendOutput(session.id, 'world');
      expect(store.getOutput(session.id)).toBe('hello world');

      expect(store.activeCount).toBe(1);
      store.delete(session.id);
      expect(store.get(session.id)).toBeUndefined();
      expect(store.activeCount).toBe(0);
    });
  });

  describe('Direct Command Executor', () => {
    it('executes a shell command directly and captures exit code and output', async () => {
      const res = await executor.executeCommand('echo test-direct-exec', undefined, 10000);
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('test-direct-exec');
    }, 15000);
  });

  describe('Integrated MCP Server', () => {
    it('exposes all tools via MCP protocol', () => {
      const mcp = createMcpServer({ executor, fsManager, sessions, ptyManager });
      expect(mcp).toBeDefined();
      expect(MCP_TOOLS.length).toBeGreaterThanOrEqual(10);
      const toolNames = MCP_TOOLS.map((t) => t.name);
      expect(toolNames).toContain('execute_command');
      expect(toolNames).toContain('execute_commands');
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('list_directory');
    });
  });
});
