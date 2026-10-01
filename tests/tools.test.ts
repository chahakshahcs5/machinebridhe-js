import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { PtyManager } from '@machinebridge/pty';
import { FilesystemManager } from '@machinebridge/fs';
import { InMemorySessionStore } from '../apps/server/src/sessions.js';
import { CommandExecutor } from '../apps/server/src/executor.js';
import { executeTool, MCP_TOOLS, type McpContext } from '../apps/server/src/mcp.js';
import { makeAuthHook } from '../apps/server/src/auth.js';

describe('MCP Tools Comprehensive Verification', () => {
  const ptyManager = new PtyManager(10, 1024 * 1024, false);
  const fsManager = new FilesystemManager();
  const sessions = new InMemorySessionStore();
  const executor = new CommandExecutor(ptyManager);
  const ctx: McpContext = { executor, fsManager, sessions, ptyManager };

  const testDir = path.resolve(process.cwd(), `scratch/test-tools-${Date.now()}`);
  const apiKey = 'tools-test-api-key';

  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });

    app = Fastify();
    app.addHook('onRequest', makeAuthHook(apiKey));

    app.get('/tools', async () => ({ tools: MCP_TOOLS }));
    app.all('/tools/:name', async (request: FastifyRequest, reply: FastifyReply) => {
      const { name } = request.params as { name: string };
      const query = (request.query as Record<string, unknown>) || {};
      const body = (request.body as Record<string, unknown>) || {};
      const args = { ...query, ...body };
      const res = await executeTool(name, args, ctx);
      if (res.isError) return reply.code(400).send(res);
      return res;
    });

    await app.ready();
  });

  afterAll(async () => {
    ptyManager.closeAll();
    await app.close();
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('Tool Schemas & Inventory', () => {
    it('exposes exactly 15 MCP tools with valid schemas', () => {
      expect(MCP_TOOLS.length).toBe(15);
      const names = MCP_TOOLS.map((t) => t.name);

      const expected = [
        'execute_command',
        'execute_commands',
        'read_file',
        'write_file',
        'list_directory',
        'delete_file',
        'make_directory',
        'move_file',
        'copy_file',
        'stat_file',
        'batch_fs',
        'create_session',
        'send_input',
        'read_output',
        'close_session',
      ];

      for (const name of expected) {
        expect(names).toContain(name);
      }
    });

    it('returns error for an unknown tool name', async () => {
      const res = await executeTool('non_existent_tool', {}, ctx);
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('Unknown tool: non_existent_tool');
    });
  });

  describe('Tool 1: execute_command', () => {
    it('successfully executes a command and captures output and exitCode 0', async () => {
      const res = await executeTool(
        'execute_command',
        { command: 'echo MB_TOOL_EXEC_OK', timeoutMs: 10000 },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('MB_TOOL_EXEC_OK');
    });

    it('returns isError: true when a command fails with non-zero exit code', async () => {
      const isWindows = process.platform === 'win32';
      const failCmd = isWindows ? 'cmd /c exit 42' : 'sh -c "exit 42"';
      const res = await executeTool('execute_command', { command: failCmd, timeoutMs: 10000 }, ctx);
      expect(res.isError).toBe(true);
    });

    it('rejects empty command with error', async () => {
      const res = await executeTool('execute_command', { command: '   ' }, ctx);
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('required');
    });
  });

  describe('Tool 2: execute_commands', () => {
    it('executes a batch of commands sequentially', async () => {
      const res = await executeTool(
        'execute_commands',
        {
          commands: ['echo step_one', 'echo step_two'],
          timeoutMs: 15000,
        },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.summary.total).toBe(2);
      expect(parsed.summary.passed).toBe(2);
      expect(parsed.summary.failed).toBe(0);
    });

    it('halts on error when stopOnError is true', async () => {
      const isWindows = process.platform === 'win32';
      const failCmd = isWindows ? 'cmd /c exit 1' : 'sh -c "exit 1"';
      const res = await executeTool(
        'execute_commands',
        {
          commands: ['echo first_cmd', failCmd, 'echo should_not_run'],
          stopOnError: true,
          timeoutMs: 15000,
        },
        ctx,
      );
      expect(res.isError).toBe(true);
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed.summary.total).toBe(3);
      expect(parsed.summary.passed).toBe(1);
      expect(parsed.summary.failed).toBe(1);
      expect(parsed.summary.skipped).toBe(1);
    });

    it('rejects empty commands array', async () => {
      const res = await executeTool('execute_commands', { commands: [] }, ctx);
      expect(res.isError).toBe(true);
    });
  });

  describe('Tools 3-10: Filesystem Operations', () => {
    const fileA = path.join(testDir, 'fileA.txt');
    const fileCopy = path.join(testDir, 'fileA_copy.txt');
    const fileMoved = path.join(testDir, 'subdir', 'fileA_moved.txt');
    const subDir = path.join(testDir, 'subdir');

    it('Tool 4: write_file writes text content and returns SHA-256', async () => {
      const res = await executeTool(
        'write_file',
        { path: fileA, content: 'Hello MachineBridge Tool Testing!' },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('Wrote');
      expect(res.content[0].text).toContain('SHA-256');
    });

    it('Tool 4: write_file validates missing path parameter', async () => {
      const res = await executeTool('write_file', { content: 'test' }, ctx);
      expect(res.isError).toBe(true);
    });

    it('Tool 3: read_file reads the written file content', async () => {
      const res = await executeTool('read_file', { path: fileA }, ctx);
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toBe('Hello MachineBridge Tool Testing!');
    });

    it('Tool 3: read_file supports offset and length chunking', async () => {
      const res = await executeTool('read_file', { path: fileA, offset: 6, length: 13 }, ctx);
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toBe('MachineBridge');
    });

    it('Tool 10: stat_file returns file metadata', async () => {
      const res = await executeTool('stat_file', { path: fileA }, ctx);
      expect(res.isError).toBeFalsy();
      const meta = JSON.parse(res.content[0].text);
      expect(meta.isFile).toBe(true);
      expect(meta.isDirectory).toBe(false);
      expect(meta.size).toBe(Buffer.byteLength('Hello MachineBridge Tool Testing!'));
    });

    it('Tool 9: copy_file copies file to destination', async () => {
      const res = await executeTool('copy_file', { source: fileA, destination: fileCopy }, ctx);
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('Copied');

      const readCopy = await executeTool('read_file', { path: fileCopy }, ctx);
      expect(readCopy.content[0].text).toBe('Hello MachineBridge Tool Testing!');
    });

    it('Tool 7: make_directory creates directory structure', async () => {
      const res = await executeTool('make_directory', { path: subDir }, ctx);
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('Created directory');
    });

    it('Tool 8: move_file moves file to destination directory', async () => {
      const res = await executeTool('move_file', { source: fileCopy, destination: fileMoved }, ctx);
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('Moved');

      const readMoved = await executeTool('read_file', { path: fileMoved }, ctx);
      expect(readMoved.content[0].text).toBe('Hello MachineBridge Tool Testing!');

      const statOld = await executeTool('stat_file', { path: fileCopy }, ctx);
      expect(statOld.isError).toBe(true);
    });

    it('Tool 5: list_directory lists entries with metadata', async () => {
      const res = await executeTool('list_directory', { path: testDir, recursive: true }, ctx);
      expect(res.isError).toBeFalsy();
      const entries = JSON.parse(res.content[0].text);
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThanOrEqual(2);
    });

    it('Tool 6: delete_file deletes file and directory recursively', async () => {
      const resFile = await executeTool('delete_file', { path: fileA }, ctx);
      expect(resFile.isError).toBeFalsy();
      expect(resFile.content[0].text).toContain('Deleted');

      const resDir = await executeTool('delete_file', { path: subDir, recursive: true }, ctx);
      expect(resDir.isError).toBeFalsy();
    });
  });

  describe('Tool 11: batch_fs', () => {
    it('executes a multi-operation batch atomically / sequentially', async () => {
      const batchFile1 = path.join(testDir, 'batch1.txt');
      const batchFile2 = path.join(testDir, 'batch2.txt');

      const res = await executeTool(
        'batch_fs',
        {
          operations: [
            { type: 'write', path: batchFile1, content: 'Batch Step 1 Content' },
            { type: 'read', path: batchFile1 },
            { type: 'copy', path: batchFile1, destination: batchFile2 },
            { type: 'read', path: batchFile2 },
            { type: 'delete', path: batchFile1 },
            { type: 'delete', path: batchFile2 },
          ],
        },
        ctx,
      );

      expect(res.isError).toBeFalsy();
      const summary = JSON.parse(res.content[0].text);
      expect(summary.total).toBe(6);
      expect(summary.passed).toBe(6);
      expect(summary.failed).toBe(0);
      expect(summary.skipped).toBe(0);
    });

    it('validates empty operations parameter', async () => {
      const res = await executeTool('batch_fs', { operations: [] }, ctx);
      expect(res.isError).toBe(true);
    });
  });

  describe('Tools 12-15: Interactive Session Lifecycle', () => {
    let createdSessionId = '';

    it('Tool 12: create_session creates a session with running PTY', async () => {
      const res = await executeTool('create_session', { ttlSeconds: 120 }, ctx);
      expect(res.isError).toBeFalsy();
      const sessionData = JSON.parse(res.content[0].text);
      expect(sessionData.sessionId).toBeDefined();
      expect(sessionData.pid).toBeGreaterThan(0);
      expect(sessionData.status).toBe('running');
      createdSessionId = sessionData.sessionId;
    });

    it('Tool 13: send_input sends input to active session', async () => {
      const res = await executeTool(
        'send_input',
        { sessionId: createdSessionId, data: 'echo session_live\r\n' },
        ctx,
      );
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain(`Sent input to session ${createdSessionId}`);
    });

    it('Tool 14: read_output reads buffered output from session', async () => {
      // Wait slightly for PTY buffer to capture echo
      await new Promise((r) => setTimeout(r, 800));
      const res = await executeTool('read_output', { sessionId: createdSessionId }, ctx);
      expect(res.isError).toBeFalsy();
      expect(typeof res.content[0].text).toBe('string');
    });

    it('Tool 15: close_session closes session and terminates process', async () => {
      const res = await executeTool('close_session', { sessionId: createdSessionId }, ctx);
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain('closed');

      const session = sessions.get(createdSessionId);
      expect(session?.status).toBe('closed');
      expect(ptyManager.get(createdSessionId)).toBeUndefined();
    });

    it('returns error when operating on non-existent session', async () => {
      const resInput = await executeTool('send_input', { sessionId: 'non-existent' }, ctx);
      expect(resInput.isError).toBe(true);

      const resOutput = await executeTool('read_output', { sessionId: 'non-existent' }, ctx);
      expect(resOutput.isError).toBe(true);

      const resClose = await executeTool('close_session', { sessionId: 'non-existent' }, ctx);
      expect(resClose.isError).toBe(true);
    });
  });

  describe('REST Tool Invocation via HTTP', () => {
    it('executes tool via POST /tools/:name with x-api-key authentication', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tools/write_file',
        headers: { 'x-api-key': apiKey },
        payload: {
          path: path.join(testDir, 'rest_test.txt'),
          content: 'Invoked via REST /tools/write_file',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.content[0].text).toContain('Wrote');

      // Verify reading back via GET /tools/read_file
      const readRes = await app.inject({
        method: 'GET',
        url: `/tools/read_file?path=${encodeURIComponent(path.join(testDir, 'rest_test.txt'))}`,
        headers: { 'x-api-key': apiKey },
      });

      expect(readRes.statusCode).toBe(200);
      const readBody = JSON.parse(readRes.body);
      expect(readBody.content[0].text).toBe('Invoked via REST /tools/write_file');
    });

    it('rejects unauthenticated requests to /tools/:name', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/tools/execute_command',
        payload: { command: 'echo test' },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
