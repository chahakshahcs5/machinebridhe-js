import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { FilesystemManager } from '@machinebridge/fs';
import {
  formatFsBatchMarkdown,
  formatFsBatchJson,
  type FsBatchResult,
} from '@machinebridge/shared';
import { MessageSchema } from '@machinebridge/protocol';

describe('Filesystem Subsystem (Bypassing Shell)', () => {
  let testDir: string;
  let fsManager: FilesystemManager;

  beforeAll(async () => {
    testDir = path.join(
      os.tmpdir(),
      `mb-fs-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
    fsManager = new FilesystemManager(testDir);
  });

  afterAll(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  });

  describe('Direct Filesystem Read / Write', () => {
    it('writes and reads a basic UTF-8 file', async () => {
      const relPath = 'src/hello.txt';
      const content = 'Hello, MachineBridge native filesystem!';

      const writeRes = await fsManager.writeFile(relPath, content);
      expect(writeRes.bytesWritten).toBe(Buffer.byteLength(content));
      expect(writeRes.sha256).toBe(createHash('sha256').update(content).digest('hex'));

      const readRes = await fsManager.readFile(relPath);
      expect(readRes.content).toBe(content);
      expect(readRes.size).toBe(Buffer.byteLength(content));
      expect(readRes.hasMore).toBe(false);
    });

    it('preserves quotes, template literals, and shell-sensitive characters byte-for-byte', async () => {
      const complexCode = [
        'import React from "react";',
        '// Comments with single \'quotes\' and "double quotes"',
        'const template = `Value: ${process.env.FOO || "$VAR"} and backticks: \\`test\\``;',
        'const regex = /^[a-zA-Z0-9_.-]+$/g;',
        'const powershellTroublemakers = "$($Host.UI.RawUI.WindowTitle) & | < > %TEMP% ^ !";',
        'export function App() {',
        '  return <div className="card" onClick={() => alert("clicked!")}>Hello</div>;',
        '}',
      ].join('\r\n');

      const relPath = 'client/src/App.tsx';
      const writeRes = await fsManager.writeFile(relPath, complexCode);
      const readRes = await fsManager.readFile(relPath);

      // Byte-for-byte exactness check
      expect(readRes.content).toBe(complexCode);
      const expectedHash = createHash('sha256')
        .update(Buffer.from(complexCode, 'utf8'))
        .digest('hex');
      expect(writeRes.sha256).toBe(expectedHash);
    });

    it('handles large files (150 KB+) with exact SHA-256 hash match', async () => {
      // Generate a 150 KB synthetic file
      const chunk =
        'Line of code: console.log("Large file test line with $variables and \'quotes\'");\n';
      const repeatCount = Math.ceil((150 * 1024) / chunk.length);
      const largeContent = chunk.repeat(repeatCount);
      const expectedHash = createHash('sha256').update(largeContent).digest('hex');

      const relPath = 'build/large-asset.js';
      const writeRes = await fsManager.writeFile(relPath, largeContent);
      expect(writeRes.bytesWritten).toBe(Buffer.byteLength(largeContent));
      expect(writeRes.sha256).toBe(expectedHash);

      // Read back in full
      const readRes = await fsManager.readFile(relPath, { length: 200 * 1024 });
      expect(readRes.content).toBe(largeContent);
      expect(createHash('sha256').update(readRes.content).digest('hex')).toBe(expectedHash);

      // Chunked read: offset and length
      const chunk1 = await fsManager.readFile(relPath, { offset: 0, length: 1024 });
      expect(chunk1.bytesRead).toBe(1024);
      expect(chunk1.hasMore).toBe(true);
      expect(chunk1.content).toBe(largeContent.slice(0, 1024));
    });

    it('supports append mode', async () => {
      const relPath = 'logs/app.log';
      await fsManager.writeFile(relPath, 'line 1\n');
      await fsManager.writeFile(relPath, 'line 2\n', { append: true });

      const readRes = await fsManager.readFile(relPath);
      expect(readRes.content).toBe('line 1\nline 2\n');
    });

    it('lists files and directories accurately', async () => {
      await fsManager.writeFile('tree/a.txt', 'aaa');
      await fsManager.writeFile('tree/sub/b.txt', 'bbb');

      const listRes = await fsManager.listFiles('tree', { recursive: true });
      const paths = listRes.entries.map((e) => e.path.replace(/\\/g, '/'));
      expect(paths).toContain('a.txt');
      expect(paths).toContain('sub');
      expect(paths).toContain('sub/b.txt');
    });

    it('moves and copies files', async () => {
      await fsManager.writeFile('move-src.txt', 'move me');
      await fsManager.moveFile('move-src.txt', 'moved/move-dest.txt');

      const destRead = await fsManager.readFile('moved/move-dest.txt');
      expect(destRead.content).toBe('move me');

      await fsManager.copyFile('moved/move-dest.txt', 'copied.txt');
      const copyRead = await fsManager.readFile('copied.txt');
      expect(copyRead.content).toBe('move me');
    });

    it('deletes files and directories recursively', async () => {
      await fsManager.writeFile('to-delete/file.txt', 'bye');
      await fsManager.deleteFile('to-delete', { recursive: true });

      await expect(fsManager.readFile('to-delete/file.txt')).rejects.toThrow();
    });
  });

  describe('Heterogeneous Batch Execution', () => {
    it('executes a sequence of mkdir, write, read, and command operations', async () => {
      const mockCmdRunner = jest.fn().mockResolvedValue({
        exitCode: 0,
        output: 'Simulated command output',
        durationMs: 10,
      });

      const batchOps = [
        { type: 'mkdir' as const, path: 'batch-test' },
        { type: 'write' as const, path: 'batch-test/pkg.json', content: '{"name": "my-pkg"}' },
        { type: 'read' as const, path: 'batch-test/pkg.json' },
        { type: 'command' as const, command: 'echo "hello from batch"' },
      ];

      const result = await fsManager.executeBatch(batchOps, true, mockCmdRunner);

      expect(result.total).toBe(4);
      expect(result.passed).toBe(4);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
      expect(mockCmdRunner).toHaveBeenCalledWith('echo "hello from batch"', undefined, undefined);

      const readItem = result.results[2];
      expect((readItem.data as { content: string }).content).toBe('{"name": "my-pkg"}');
    });

    it('halts on first error when stopOnError is true and marks remaining as skipped', async () => {
      const batchOps = [
        { type: 'write' as const, path: 'good.txt', content: 'good' },
        { type: 'read' as const, path: 'non-existent-file-404.txt' }, // Will fail
        { type: 'write' as const, path: 'should-not-run.txt', content: 'skip' },
      ];

      const result = await fsManager.executeBatch(batchOps, true);

      expect(result.total).toBe(3);
      expect(result.passed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.skipped).toBe(1);

      expect(result.results[0].success).toBe(true);
      expect(result.results[1].success).toBe(false);
      expect(result.results[2].success).toBe(false);
      expect(result.results[2].error).toBe('Skipped due to previous operation failure');
    });
  });

  describe('Security Sandboxing', () => {
    it('rejects paths with null bytes', () => {
      expect(() => fsManager.resolvePath('file\0.txt')).toThrow(/null bytes/i);
    });

    it('rejects Windows reserved device names', () => {
      const reserved = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1', 'aux.txt', 'nul.json'];
      for (const name of reserved) {
        expect(() => fsManager.resolvePath(name)).toThrow(/reserved Windows device name/i);
      }
    });

    it('blocks path traversal outside the authorized workspace root', () => {
      expect(() => fsManager.resolvePath('../../../Windows/System32/cmd.exe')).toThrow(
        /PATH_TRAVERSAL_DETECTED/i,
      );
      expect(() => fsManager.resolvePath('/etc/passwd')).toThrow(/PATH_TRAVERSAL_DETECTED/i);
    });
  });

  describe('MCP & Filesystem Formatting', () => {
    it('has all filesystem methods available on FilesystemManager', () => {
      expect(typeof fsManager.readFile).toBe('function');
      expect(typeof fsManager.writeFile).toBe('function');
      expect(typeof fsManager.deleteFile).toBe('function');
      expect(typeof fsManager.makeDirectory).toBe('function');
      expect(typeof fsManager.listFiles).toBe('function');
      expect(typeof fsManager.moveFile).toBe('function');
      expect(typeof fsManager.copyFile).toBe('function');
      expect(typeof fsManager.executeBatch).toBe('function');
    });

    it('formats batch results into clean Markdown and JSON', () => {
      const mockResult: FsBatchResult = {
        ok: true,
        total: 3,
        passed: 2,
        failed: 0,
        skipped: 1,
        results: [
          {
            index: 0,
            type: 'write',
            path: 'package.json',
            success: true,
            data: { bytesWritten: 120, sha256: 'abcdef1234567890' },
            durationMs: 5,
          },
          {
            index: 1,
            type: 'command',
            command: 'npm test',
            success: true,
            data: { output: 'PASS tests' },
            durationMs: 50,
          },
          {
            index: 2,
            type: 'write',
            path: 'dist/app.js',
            success: false,
            error: 'Skipped due to previous operation failure',
            durationMs: 0,
          },
        ],
      };

      const md = formatFsBatchMarkdown(mockResult);
      expect(md).toContain('### 📋 Batch Operations: 2/3 Succeeded, 1 Skipped');
      expect(md).toContain('WRITE `package.json` — ✓ Succeeded');
      expect(md).toContain('Wrote 120 bytes');
      expect(md).toContain('Command `npm test` — ✓ Succeeded');
      expect(md).toContain('PASS tests');
      expect(md).toContain('WRITE `dist/app.js` — ⊘ Skipped');

      const jsonStr = formatFsBatchJson(mockResult);
      const parsed = JSON.parse(jsonStr) as FsBatchResult;
      expect(parsed.passed).toBe(2);
      expect(parsed.skipped).toBe(1);
    });
  });

  describe('Protocol Message Schema', () => {
    it('validates fs.request and fs.response', () => {
      const validReq = {
        type: 'fs.request',
        requestId: 'req-1',
        action: 'write',
        path: 'src/index.ts',
        content: 'console.log("hello");',
      };
      expect(() => MessageSchema.parse(validReq)).not.toThrow();

      const validResp = {
        type: 'fs.response',
        requestId: 'req-1',
        success: true,
        data: { bytesWritten: 20 },
      };
      expect(() => MessageSchema.parse(validResp)).not.toThrow();
    });

    it('validates fs.batch.request and fs.batch.response', () => {
      const validBatchReq = {
        type: 'fs.batch.request',
        requestId: 'batch-req-1',
        operations: [
          { type: 'mkdir', path: 'src' },
          { type: 'write', path: 'src/index.ts', content: 'test' },
          { type: 'command', command: 'node src/index.ts' },
        ],
        stopOnError: true,
      };
      expect(() => MessageSchema.parse(validBatchReq)).not.toThrow();

      const validBatchResp = {
        type: 'fs.batch.response',
        requestId: 'batch-req-1',
        success: true,
        summary: { total: 3, passed: 3, failed: 0, skipped: 0 },
        results: [
          { index: 0, type: 'mkdir', path: 'src', success: true },
          { index: 1, type: 'write', path: 'src/index.ts', success: true },
          { index: 2, type: 'command', command: 'node src/index.ts', success: true },
        ],
      };
      expect(() => MessageSchema.parse(validBatchResp)).not.toThrow();
    });
  });
});
