import { PtyManager } from '@machinebridge/pty';
import {
  CommandExecutor,
  CommandOutputParser,
  detectShellType,
  createCommandWithMarkers,
} from '../apps/server/src/executor.js';
import { InMemorySessionStore } from '../apps/server/src/sessions.js';

describe('Command Execution & PTY Completion Engine', () => {
  const ptyManager = new PtyManager(10, 16 * 1024 * 1024, false);
  const executor = new CommandExecutor(ptyManager);
  const sessions = new InMemorySessionStore();

  afterAll(() => {
    ptyManager.closeAll();
  });

  describe('1. Unit Tests: CommandOutputParser & Marker Detection', () => {
    it('detects completion marker and extracts output and exit code 0', () => {
      const markerId = 'unit123';
      const parser = new CommandOutputParser(markerId, 'powershell');

      const chunk1 = 'Some initial output\r\n';
      const chunk2 = `[__MB_START_${markerId}__]\r\nReal command output line 1\r\nReal command output line 2\r\n`;
      const chunk3 = `[__MB_COMPL_${markerId}_0__]\r\nPS C:\\Users\\test> `;

      expect(parser.appendChunk(chunk1)).toBe(false);
      expect(parser.appendChunk(chunk2)).toBe(false);
      expect(parser.appendChunk(chunk3)).toBe(true);

      const res = parser.getResult();
      expect(res).toBeDefined();
      expect(res?.exitCode).toBe(0);
      expect(res?.output).toBe('Real command output line 1\nReal command output line 2');
    });

    it('Scenario 5: handles completion marker split across multiple arbitrary chunks', () => {
      const markerId = 'split456';
      const parser = new CommandOutputParser(markerId, 'powershell');

      // The marker is "[__MB_COMPL_split456_0__]"
      // Split into 5 tiny fragments across chunk boundaries
      const chunks = [
        'normal command output line\r\n',
        `[__MB_START_${markerId}__]\r\nhello from test\r\n`,
        '[__MB_',
        'COMPL_',
        `${markerId}_`,
        '42_',
        '_]\r\n',
      ];

      let completed = false;
      for (const chunk of chunks) {
        completed = parser.appendChunk(chunk);
      }

      expect(completed).toBe(true);
      const res = parser.getResult();
      expect(res).toBeDefined();
      expect(res?.exitCode).toBe(42);
      expect(res?.output).toBe('hello from test');
    });

    it('Scenario 6: handles ANSI escape sequences without corrupting output or marker', () => {
      const markerId = 'ansi789';
      const parser = new CommandOutputParser(markerId, 'powershell');

      const chunks = [
        `\x1b[33mPS C:\\> \x1b[0m\x1b[36mWrite-Output\x1b[0m\r\n`,
        `[__MB_START_${markerId}__]\r\n`,
        `\x1b[32mSUCCESSFUL_COLOR_OUTPUT\x1b[0m\r\n\x1b[1;34mAnother line\x1b[0m\r\n`,
        `\x1b[0m[__MB_COMPL_${markerId}_0__]\x1b[0m\r\n`,
      ];

      for (const c of chunks) {
        parser.appendChunk(c);
      }

      expect(parser.isCompleted()).toBe(true);
      const res = parser.getResult();
      expect(res?.exitCode).toBe(0);
      expect(res?.output).toContain('SUCCESSFUL_COLOR_OUTPUT');
      expect(res?.output).toContain('Another line');
      expect(res?.output).not.toContain('\x1b[');
    });

    it('Scenario 4 (Unit): consumes large multi-megabyte output without stalling or failing', () => {
      const markerId = 'large101';
      const parser = new CommandOutputParser(markerId, 'powershell');

      // Generate 2MB of output across 20 chunks of 100KB each
      parser.appendChunk(`[__MB_START_${markerId}__]\r\n`);
      const block = 'A'.repeat(1024 * 100) + '\n';
      for (let i = 0; i < 20; i++) {
        const done = parser.appendChunk(block);
        expect(done).toBe(false);
      }
      parser.appendChunk(`[__MB_COMPL_${markerId}_0__]\r\n`);

      expect(parser.isCompleted()).toBe(true);
      const res = parser.getResult();
      expect(res?.exitCode).toBe(0);
      expect(res?.output.length).toBeGreaterThan(1024 * 1024);
    });
  });

  describe('2. Shell Specific Invocation Helpers', () => {
    it('detects shell types correctly', () => {
      expect(detectShellType('powershell.exe')).toBe('powershell');
      expect(detectShellType('pwsh')).toBe('powershell');
      expect(detectShellType('cmd.exe')).toBe('cmd');
      expect(detectShellType('cmd')).toBe('cmd');
      expect(detectShellType('/bin/bash')).toBe('sh');
      expect(detectShellType('/bin/zsh')).toBe('sh');
    });

    it('formats PowerShell commands with try/finally and [Console]::Out.WriteLine', () => {
      const formatted = createCommandWithMarkers('dir', 'testId', 'powershell');
      expect(formatted).toContain('[__MB_START_testId__]');
      expect(formatted).toContain('[__MB_COMPL_testId_');
      expect(formatted).toContain('$LASTEXITCODE');
      expect(formatted).toContain('[Console]::Out.WriteLine');
    });

    it('formats CMD commands with deferred errorlevel evaluation', () => {
      const formatted = createCommandWithMarkers('dir', 'testId', 'cmd');
      expect(formatted).toContain('[__MB_START_testId__]');
      expect(formatted).toContain('%%ERRORLEVEL%%');
    });
  });

  describe('3. End-to-End PTY Execution Scenarios', () => {
    it('Scenario 1: Basic command execution (`echo hello`)', async () => {
      const res = await executor.executeCommand('echo hello');
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('hello');
    });

    it('Scenario 3: Non-zero exit code capture', async () => {
      const isWindows = process.platform === 'win32';
      const failCmd = isWindows ? 'cmd /c exit 1' : 'sh -c "exit 1"';
      const res = await executor.executeCommand(failCmd);
      expect(res.exitCode).toBe(1);
    });

    it('Scenario 7: PowerShell specific command with cmdlets and dates', async () => {
      if (process.platform !== 'win32') return;
      const res = await executor.executeCommand(
        "Write-Output 'single-command-ok'; Get-Date -Format o",
        undefined,
        15000,
        'powershell.exe',
      );
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('single-command-ok');
    });

    it('Scenario 8: CMD specific commands with command concatenation', async () => {
      if (process.platform !== 'win32') return;
      const res = await executor.executeCommand(
        'echo cmd_step_one && echo cmd_step_two',
        undefined,
        15000,
        'cmd.exe',
      );
      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('cmd_step_one');
      expect(res.output).toContain('cmd_step_two');
    });

    it('Scenario 9 & 10: Long-running and silent command completion without premature timeout', async () => {
      const isWindows = process.platform === 'win32';
      // Command sleeps for 2 seconds silently then echoes success
      const sleepCmd = isWindows
        ? 'powershell -NoProfile -Command "Start-Sleep -Seconds 2; Write-Output \'slept-successfully\'"'
        : 'sleep 2 && echo "slept-successfully"';

      const start = Date.now();
      const res = await executor.executeCommand(sleepCmd, undefined, 10000);
      const elapsed = Date.now() - start;

      expect(res.exitCode).toBe(0);
      expect(res.output).toContain('slept-successfully');
      expect(elapsed).toBeGreaterThanOrEqual(1800);
    }, 15000);

    it('Scenario 12: Batch execution (executeCommands) with sequential exit codes', async () => {
      const isWindows = process.platform === 'win32';
      const commands = isWindows
        ? ["Write-Output 'batch-1'", "Write-Output 'batch-2'", "Write-Output 'batch-3'"]
        : ['echo "batch-1"', 'echo "batch-2"', 'echo "batch-3"'];

      const batchRes = await executor.executeCommands(commands, undefined, 20000, true);

      expect(batchRes.summary.total).toBe(3);
      expect(batchRes.summary.passed).toBe(3);
      expect(batchRes.summary.failed).toBe(0);
      expect(batchRes.summary.skipped).toBe(0);

      expect(batchRes.results[0].command).toContain('batch-1');
      expect(batchRes.results[0].output).toContain('batch-1');
      expect(batchRes.results[0].exitCode).toBe(0);

      expect(batchRes.results[1].command).toContain('batch-2');
      expect(batchRes.results[1].output).toContain('batch-2');
      expect(batchRes.results[1].exitCode).toBe(0);

      expect(batchRes.results[2].command).toContain('batch-3');
      expect(batchRes.results[2].output).toContain('batch-3');
      expect(batchRes.results[2].exitCode).toBe(0);
    }, 25000);

    it('Scenario 11: Interactive persistent session lifecycle with multi-command execution', async () => {
      const sessionId = 'test-interactive-seq';
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? 'powershell.exe' : '/bin/bash';

      const session = ptyManager.create(
        {
          id: sessionId,
          cols: 120,
          rows: 40,
          shell,
        },
        {
          onData: (d) => sessions.appendOutput(sessionId, d),
          onExit: () => sessions.setStatus(sessionId, 'closed'),
        },
      );
      expect(session.pid).toBeGreaterThan(0);
      sessions.create(3600, shell, isWindows ? 'powershell' : 'sh');

      // Wait 300ms for shell to initialize
      await new Promise((r) => setTimeout(r, 300));

      // Command 1 in persistent session
      const cmd1 = isWindows ? "Write-Output 'session-cmd-1'" : 'echo "session-cmd-1"';
      const res1 = await executor.executeCommand(cmd1, undefined, 10000, shell, sessionId);
      expect(res1.exitCode).toBe(0);
      expect(res1.output).toContain('session-cmd-1');

      // Command 2 in the same persistent session
      const cmd2 = isWindows ? "Write-Output 'session-cmd-2'" : 'echo "session-cmd-2"';
      const res2 = await executor.executeCommand(cmd2, undefined, 10000, shell, sessionId);
      expect(res2.exitCode).toBe(0);
      expect(res2.output).toContain('session-cmd-2');

      // Verify session is still alive
      expect(ptyManager.get(sessionId)).toBeDefined();

      // Teardown
      ptyManager.close(sessionId);
      expect(ptyManager.get(sessionId)).toBeUndefined();
    }, 25000);
  });
});
