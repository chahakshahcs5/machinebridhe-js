import type { TerminalSignal } from '@machinebridge/protocol';
import type { McpContext, ToolExecutionResult } from '../types.js';

export async function handleCreateSession(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const ttl = typeof args.ttlSeconds === 'number' ? args.ttlSeconds : 3600;
  const resolvedShell =
    args.shell !== undefined && args.shell !== null
      ? String(args.shell)
      : process.platform === 'win32'
        ? process.env.MACHINEBRIDGE_DEFAULT_SHELL || 'powershell.exe'
        : undefined;
  const shellType =
    resolvedShell && /(powershell|pwsh)/i.test(resolvedShell)
      ? 'powershell'
      : resolvedShell && /cmd/i.test(resolvedShell)
        ? 'cmd'
        : 'sh';
  const session = ctx.sessions.create(ttl, resolvedShell, shellType);
  const ptySession = ctx.ptyManager.create(
    {
      id: session.id,
      cols: typeof args.cols === 'number' ? args.cols : 80,
      rows: typeof args.rows === 'number' ? args.rows : 24,
      cwd: args.cwd ? String(args.cwd) : undefined,
      shell: resolvedShell,
    },
    {
      onData: (d: string) => ctx.sessions.appendOutput(session.id, d),
      onExit: () => ctx.sessions.setStatus(session.id, 'closed'),
    },
  );
  ctx.sessions.setStatus(session.id, 'running');
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            sessionId: session.id,
            pid: ptySession.pid,
            status: 'running',
            expiresAt: session.expiresAt.toISOString(),
          },
          null,
          2,
        ),
      },
    ],
  };
}

export async function handleSendInput(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const sessionId = String(args.sessionId || args.session_id || args.id || '').trim();
  if (!sessionId) {
    return {
      content: [{ type: 'text', text: 'Error: "sessionId" parameter is required' }],
      isError: true,
    };
  }
  const data = args.data !== undefined ? String(args.data) : '';
  const signal = args.signal ? (String(args.signal) as TerminalSignal) : undefined;
  let ptySession = ctx.ptyManager.get(sessionId);
  if (!ptySession) {
    const storeSession = ctx.sessions.get(sessionId);
    if (storeSession && storeSession.status !== 'closed') {
      ptySession = ctx.ptyManager.create(
        { id: sessionId, cols: 80, rows: 24 },
        {
          onData: (d: string) => ctx.sessions.appendOutput(sessionId, d),
          onExit: () => ctx.sessions.setStatus(sessionId, 'closed'),
        },
      );
      ctx.sessions.setStatus(sessionId, 'running');
    }
  }
  if (!ptySession) {
    return {
      content: [{ type: 'text', text: `Session ${sessionId} not active or not found` }],
      isError: true,
    };
  }
  if (data) ptySession.write(data);
  if (signal) ptySession.signal(signal);
  return {
    content: [{ type: 'text', text: `Sent input to session ${sessionId}` }],
  };
}

export async function handleReadOutput(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const sessionId = String(args.sessionId || args.session_id || args.id || '').trim();
  if (!sessionId) {
    return {
      content: [{ type: 'text', text: 'Error: "sessionId" parameter is required' }],
      isError: true,
    };
  }
  const session = ctx.sessions.get(sessionId);
  if (!session) {
    return {
      content: [{ type: 'text', text: `Error: Session ${sessionId} not found` }],
      isError: true,
    };
  }
  const output = ctx.sessions.getOutput(sessionId);
  return {
    content: [{ type: 'text', text: output }],
  };
}

export async function handleCloseSession(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const sessionId = String(args.sessionId || args.session_id || args.id || '').trim();
  if (!sessionId) {
    return {
      content: [{ type: 'text', text: 'Error: "sessionId" parameter is required' }],
      isError: true,
    };
  }
  const session = ctx.sessions.get(sessionId);
  const ptySession = ctx.ptyManager.get(sessionId);
  if (!session && !ptySession) {
    return {
      content: [{ type: 'text', text: `Error: Session ${sessionId} not found` }],
      isError: true,
    };
  }
  ctx.ptyManager.close(sessionId);
  if (session) {
    ctx.sessions.setStatus(sessionId, 'closed');
  }
  return {
    content: [{ type: 'text', text: `Session ${sessionId} closed successfully` }],
    isError: false,
  };
}
