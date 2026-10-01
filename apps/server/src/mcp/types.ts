import type { CommandExecutor } from '../executor/index.js';
import type { FilesystemManager } from '@machinebridge/fs';
import type { InMemorySessionStore } from '../sessions.js';
import type { PtyManager } from '@machinebridge/pty';

export interface McpContext {
  executor: CommandExecutor;
  fsManager: FilesystemManager;
  sessions: InMemorySessionStore;
  ptyManager: PtyManager;
  isCallerAuthenticated?: (extra?: unknown) => boolean;
  getBaseUrl?: () => string;
}

export interface ToolExecutionResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}
