import type { McpContext, ToolExecutionResult } from '../types.js';

export async function handleExecuteCommand(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const command = String(args.command || '').trim();
  if (!command) {
    return {
      content: [
        { type: 'text', text: 'Error: "command" parameter is required and cannot be empty' },
      ],
      isError: true,
    };
  }
  const cwd = args.cwd ? String(args.cwd) : undefined;
  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 15000;
  const shell = args.shell ? String(args.shell) : undefined;
  const sessionId = args.sessionId ? String(args.sessionId) : undefined;
  const res = await ctx.executor.executeCommand(command, cwd, timeoutMs, shell, sessionId);
  return {
    content: [
      {
        type: 'text',
        text: res.output || '(Command completed with no output)',
      },
    ],
    isError: res.exitCode !== 0,
  };
}

export async function handleExecuteCommands(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const rawCommands = args.commands ?? args.command;
  let commands: string[] = [];
  if (Array.isArray(rawCommands)) {
    commands = rawCommands.map(String).filter((c) => c.trim().length > 0);
  } else if (typeof rawCommands === 'string' && rawCommands.trim()) {
    commands = [rawCommands.trim()];
  }
  if (commands.length === 0) {
    return {
      content: [
        {
          type: 'text',
          text: 'Error: "commands" parameter must be a non-empty array of strings',
        },
      ],
      isError: true,
    };
  }
  const cwd = args.cwd ? String(args.cwd) : undefined;
  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 30000;
  const stopOnError = args.stopOnError !== undefined ? Boolean(args.stopOnError) : true;
  const shell = args.shell ? String(args.shell) : undefined;
  const sessionId = args.sessionId ? String(args.sessionId) : undefined;
  const res = await ctx.executor.executeCommands(
    commands,
    cwd,
    timeoutMs,
    stopOnError,
    shell,
    sessionId,
  );
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(res, null, 2),
      },
    ],
    isError: res.summary.failed > 0,
  };
}
