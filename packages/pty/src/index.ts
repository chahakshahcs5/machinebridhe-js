import * as nodePty from 'node-pty';
import type { IPty } from 'node-pty';
import { spawnSync } from 'node:child_process';
import type { TerminalSignal } from '@machinebridge/protocol';

const pty = (
  'spawn' in nodePty ? nodePty : ((nodePty as { default?: typeof nodePty }).default ?? nodePty)
) as typeof nodePty;

export function killProcessTree(pid: number): void {
  if (!pid || pid <= 0) return;
  try {
    if (process.platform === 'win32') {
      // /F = Force termination
      // /T = Terminate tree (the specified process and all child processes started by it)
      // /PID = Target PID
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          spawnSync('pkill', ['-9', '-P', String(pid)], { stdio: 'ignore' });
        } catch {
          // ignore
        }
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // Process might already have exited
  }
}

export interface PtyOptions {
  id: string;
  cols: number;
  rows: number;
  shell?: string | null;
  args?: string[];
  cwd?: string;
}

export interface PtyCallbacks {
  onData: (data: string) => void;
  onExit: (exitCode: number, signal?: number) => void;
  onError?: (error: Error) => void;
}

export class PtySession {
  private process?: IPty;
  private closed = false;
  private bufferedBytes = 0;
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(exitCode: number, signal?: number) => void>();
  private readonly errorListeners = new Set<(error: Error) => void>();

  constructor(
    public readonly id: string,
    private readonly options: PtyOptions,
    private readonly callbacks: PtyCallbacks,
    private readonly maxBufferBytes: number,
  ) {}

  get pid(): number {
    return this.process?.pid ?? 0;
  }

  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onExit(listener: (exitCode: number, signal?: number) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  start(): void {
    if (this.process) {
      throw new Error('PTY_ALREADY_STARTED');
    }

    const shell = this.options.shell ?? this.defaultShell();
    const args = this.options.args ?? [];
    const isWindows = process.platform === 'win32';
    const useConpty = process.env.MACHINEBRIDGE_USE_CONPTY === 'true';

    try {
      this.process = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols: this.options.cols,
        rows: this.options.rows,
        cwd: this.options.cwd ?? process.cwd(),
        env: this.safeEnvironment(),
        ...(isWindows ? { useConpty } : {}),
      });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onError?.(normalized);
      for (const listener of this.errorListeners) {
        try {
          listener(normalized);
        } catch {
          // ignore
        }
      }
      throw normalized;
    }

    this.process.onData((data) => {
      this.bufferedBytes += Buffer.byteLength(data, 'utf8');
      if (this.bufferedBytes > this.maxBufferBytes) {
        const bufErr = new Error('PTY_OUTPUT_BUFFER_EXCEEDED');
        this.callbacks.onError?.(bufErr);
        for (const listener of this.errorListeners) {
          try {
            listener(bufErr);
          } catch {
            // ignore
          }
        }
        this.close();
        return;
      }
      this.callbacks.onData(data);
      for (const listener of this.dataListeners) {
        try {
          listener(data);
        } catch {
          // ignore
        }
      }
    });

    this.process.onExit(({ exitCode, signal }) => {
      if (!this.closed) {
        this.closed = true;
        const targetPid = this.process?.pid;
        if (targetPid) {
          killProcessTree(targetPid);
        }
        this.callbacks.onExit(exitCode, signal);
        for (const listener of this.exitListeners) {
          try {
            listener(exitCode, signal);
          } catch {
            // ignore
          }
        }
      }
    });
  }

  write(data: string): void {
    if (!this.process || this.closed) {
      throw new Error('PTY_NOT_RUNNING');
    }
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.process || this.closed) {
      throw new Error('PTY_NOT_RUNNING');
    }
    this.process.resize(cols, rows);
  }

  signal(signal: TerminalSignal): void {
    if (!this.process || this.closed) {
      return;
    }

    try {
      if (process.platform === 'win32') {
        if (signal === 'SIGKILL' || signal === 'SIGTERM') {
          this.close();
        }
        return;
      }
      this.process.kill(signal);
    } catch (error) {
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  resetBufferCount(): void {
    this.bufferedBytes = 0;
  }

  close(): void {
    if (!this.process || this.closed) {
      return;
    }
    this.closed = true;
    const targetPid = this.process.pid;
    try {
      this.process.kill();
    } catch {
      // The process may already have exited.
    }
    if (targetPid) {
      killProcessTree(targetPid);
    }
    this.process = undefined;
  }

  private defaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.MACHINEBRIDGE_DEFAULT_SHELL || 'powershell.exe';
    }
    return process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  }

  private safeEnvironment(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }
}

export class PtyManager {
  private readonly sessions = new Map<string, PtySession>();
  private exitHookRegistered = false;

  constructor(
    private readonly maxSessions: number,
    private readonly maxBufferBytes: number,
    registerHooks: boolean = true,
  ) {
    if (registerHooks && process.env.NODE_ENV !== 'test') {
      this.registerExitHooks();
    }
  }

  public registerExitHooks(): void {
    if (this.exitHookRegistered) return;
    this.exitHookRegistered = true;

    const cleanup = (): void => {
      this.closeAll();
    };

    process.once('exit', cleanup);
    process.once('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
    process.once('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    if (process.platform !== 'win32') {
      process.once('SIGHUP', () => {
        cleanup();
        process.exit(0);
      });
    }
  }

  create(options: PtyOptions, callbacks: PtyCallbacks): PtySession {
    if (this.sessions.size >= this.maxSessions) {
      throw new Error('MAX_SESSIONS');
    }
    if (this.sessions.has(options.id)) {
      throw new Error('SESSION_EXISTS');
    }

    const session = new PtySession(
      options.id,
      options,
      {
        ...callbacks,
        onExit: (code, signal) => {
          this.sessions.delete(options.id);
          callbacks.onExit(code, signal);
        },
      },
      this.maxBufferBytes,
    );

    try {
      session.start();
      this.sessions.set(options.id, session);
      return session;
    } catch (error) {
      session.close();
      throw error;
    }
  }

  get(id: string): PtySession | undefined {
    return this.sessions.get(id);
  }

  close(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.close();
    this.sessions.delete(id);
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.close(id);
    }
  }
}
