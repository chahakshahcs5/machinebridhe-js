import { PtyManager, type PtySession } from '@machinebridge/pty';
import { createId } from '@machinebridge/shared';
import { CommandOutputParser, cleanTerminalOutput } from './parser.js';
import {
  detectShellType,
  createCommandWithMarkers,
  getShellAndArgsForCommand,
  type ShellType,
} from './shells.js';

export interface BatchCommandResult {
  command: string;
  exitCode: number;
  status: 'success' | 'failed' | 'skipped';
  output: string;
  durationMs: number;
}

export interface BatchExecuteResult {
  sessionId: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: BatchCommandResult[];
}

export class CommandExecutor {
  constructor(private readonly ptyManager: PtyManager) {}

  public async executeInSession(
    session: PtySession,
    command: string,
    shellType: ShellType,
    timeoutMs: number = 30000,
    idleTimeoutMs?: number,
  ): Promise<{ output: string; exitCode: number }> {
    const markerId = createId().replace(/-/g, '').substring(0, 16);
    const parser = new CommandOutputParser(markerId, shellType);
    session.resetBufferCount();

    return new Promise<{ output: string; exitCode: number }>((resolve, reject) => {
      let isDone = false;
      let idleTimer: NodeJS.Timeout | undefined;

      const resetIdleTimer = (): void => {
        if (idleTimeoutMs && idleTimeoutMs > 0) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            if (isDone) return;
            finish({
              output:
                (parser.getResult()?.output || cleanTerminalOutput(parser.getRawBuffer())) +
                `\n(Command timed out: no output received for ${idleTimeoutMs}ms)`,
              exitCode: 124,
            });
          }, idleTimeoutMs);
        }
      };

      const finish = (result: { output: string; exitCode: number }): void => {
        if (isDone) return;
        isDone = true;
        clearTimeout(commandTimer);
        if (idleTimer) clearTimeout(idleTimer);
        removeData();
        removeExit();
        removeError();
        resolve(result);
      };

      const commandTimer = setTimeout(() => {
        if (isDone) return;
        try {
          session.write('\x03');
        } catch {
          // ignore
        }
        finish({
          output:
            (parser.getResult()?.output || cleanTerminalOutput(parser.getRawBuffer())) +
            `\n(Command execution timed out after ${timeoutMs}ms)`,
          exitCode: 124,
        });
      }, timeoutMs);

      const removeData = session.onData((data) => {
        resetIdleTimer();
        if (parser.appendChunk(data)) {
          const res = parser.getResult();
          if (res) finish(res);
        }
      });

      const removeExit = session.onExit((exitCode) => {
        const res = parser.completeOnProcessExit(exitCode);
        finish(res);
      });

      const removeError = session.onError((err) => {
        if (!isDone) {
          isDone = true;
          clearTimeout(commandTimer);
          if (idleTimer) clearTimeout(idleTimer);
          removeData();
          removeExit();
          removeError();
          reject(err);
        }
      });

      resetIdleTimer();
      const invocation = createCommandWithMarkers(command, markerId, shellType);
      session.write(invocation);
    });
  }

  public async executeCommand(
    command: string,
    cwd?: string,
    timeoutMs: number = 15000,
    shell?: string,
    sessionId?: string,
    idleTimeoutMs?: number,
  ): Promise<{ sessionId: string; output: string; exitCode: number }> {
    if (sessionId) {
      const session = this.ptyManager.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found or not active`);
      }
      const shellType = detectShellType(shell);
      const res = await this.executeInSession(
        session,
        command,
        shellType,
        timeoutMs,
        idleTimeoutMs,
      );
      return {
        sessionId,
        output: res.output,
        exitCode: res.exitCode,
      };
    }

    const sid = createId();
    const { shell: resolvedShell, args } = getShellAndArgsForCommand(command, shell);

    return new Promise<{ sessionId: string; output: string; exitCode: number }>(
      (resolve, reject) => {
        let output = '';
        let completed = false;
        let session: PtySession | undefined;

        const cleanup = (): void => {
          clearTimeout(timer);
          try {
            session?.close();
          } catch {
            // ignore
          }
          this.ptyManager.close(sid);
        };

        const timer = setTimeout(() => {
          if (completed) return;
          completed = true;
          cleanup();
          resolve({
            sessionId: sid,
            output: (
              cleanTerminalOutput(output) + `\n(Command execution timed out after ${timeoutMs}ms)`
            ).trim(),
            exitCode: 124,
          });
        }, timeoutMs);

        try {
          session = this.ptyManager.create(
            {
              id: sid,
              cols: 120,
              rows: 40,
              cwd,
              shell: resolvedShell,
              args,
            },
            {
              onData: (data: string) => {
                output += data;
              },
              onExit: (exitCode: number) => {
                if (!completed) {
                  completed = true;
                  cleanup();
                  resolve({
                    sessionId: sid,
                    output: cleanTerminalOutput(output),
                    exitCode: typeof exitCode === 'number' ? exitCode : 0,
                  });
                }
              },
              onError: (err: Error) => {
                if (!completed) {
                  completed = true;
                  cleanup();
                  reject(err);
                }
              },
            },
          );
        } catch (err) {
          cleanup();
          reject(err);
        }
      },
    );
  }

  public async executeCommands(
    commands: string[],
    cwd?: string,
    timeoutMs: number = 30000,
    stopOnError: boolean = true,
    shell?: string,
    sessionId?: string,
  ): Promise<BatchExecuteResult> {
    if (!commands || commands.length === 0) {
      return {
        sessionId: sessionId || '',
        summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
        results: [],
      };
    }

    const sid = sessionId || createId();
    const isEphemeral = !sessionId;
    const shellType = detectShellType(shell);
    let session: PtySession | undefined;

    if (sessionId) {
      session = this.ptyManager.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found or not active`);
      }
    } else {
      const resolvedShell =
        shell ||
        (process.platform === 'win32'
          ? process.env.MACHINEBRIDGE_DEFAULT_SHELL || 'powershell.exe'
          : process.env.SHELL || '/bin/bash');

      session = this.ptyManager.create(
        {
          id: sid,
          cols: 120,
          rows: 40,
          cwd,
          shell: resolvedShell,
        },
        {
          onData: () => undefined,
          onExit: () => undefined,
        },
      );
      // Wait slightly for shell prompt to initialize
      await new Promise((r) => setTimeout(r, 200));
    }

    const results: BatchCommandResult[] = [];
    const startTime = Date.now();

    try {
      for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i];
        const elapsed = Date.now() - startTime;
        const remainingTime = Math.max(1000, timeoutMs - elapsed);

        if (elapsed >= timeoutMs) {
          results.push({
            command: cmd,
            exitCode: 124,
            status: 'failed',
            output: '(Batch execution timed out)',
            durationMs: 0,
          });
          for (let j = i + 1; j < commands.length; j++) {
            results.push({
              command: commands[j],
              exitCode: -1,
              status: 'skipped',
              output: '',
              durationMs: 0,
            });
          }
          break;
        }

        const cmdStart = Date.now();
        const res = await this.executeInSession(session, cmd, shellType, remainingTime);
        const durationMs = Date.now() - cmdStart;
        const isSuccess = res.exitCode === 0;

        results.push({
          command: cmd,
          exitCode: res.exitCode,
          status: isSuccess ? 'success' : 'failed',
          output: res.output,
          durationMs,
        });

        if (!isSuccess && stopOnError) {
          for (let j = i + 1; j < commands.length; j++) {
            results.push({
              command: commands[j],
              exitCode: -1,
              status: 'skipped',
              output: '',
              durationMs: 0,
            });
          }
          break;
        }
      }
    } finally {
      if (isEphemeral && session) {
        try {
          session.close();
        } catch {
          // ignore
        }
        this.ptyManager.close(sid);
      }
    }

    const passed = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;

    return {
      sessionId: sid,
      summary: {
        total: commands.length,
        passed,
        failed,
        skipped,
      },
      results,
    };
  }
}
