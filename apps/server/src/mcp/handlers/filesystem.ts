import type { FsOperation } from '@machinebridge/protocol';
import type { McpContext, ToolExecutionResult } from '../types.js';

export async function handleReadFile(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const filePath = String(args.path || '').trim();
  if (!filePath) {
    return {
      content: [{ type: 'text', text: 'Error: "path" parameter is required' }],
      isError: true,
    };
  }
  const res = await ctx.fsManager.readFile(filePath, {
    offset: typeof args.offset === 'number' ? args.offset : undefined,
    length: typeof args.length === 'number' ? args.length : undefined,
    encoding: (args.encoding as 'utf8' | 'base64') || undefined,
  });
  return {
    content: [{ type: 'text', text: res.content }],
  };
}

export async function handleWriteFile(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const filePath = String(args.path || '').trim();
  if (!filePath) {
    return {
      content: [{ type: 'text', text: 'Error: "path" parameter is required' }],
      isError: true,
    };
  }
  const content = args.content !== undefined && args.content !== null ? String(args.content) : '';
  const res = await ctx.fsManager.writeFile(filePath, content, {
    append: Boolean(args.append),
    encoding: (args.encoding as 'utf8' | 'base64') || undefined,
  });
  return {
    content: [
      {
        type: 'text',
        text: `Wrote ${res.bytesWritten} bytes to ${res.path} (SHA-256: ${res.sha256})`,
      },
    ],
  };
}

export async function handleListDirectory(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const dirPath = String(args.path || '.');
  const res = await ctx.fsManager.listFiles(dirPath, {
    recursive: Boolean(args.recursive),
  });
  return {
    content: [{ type: 'text', text: JSON.stringify(res.entries, null, 2) }],
  };
}

export async function handleDeleteFile(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const filePath = String(args.path || '').trim();
  if (!filePath) {
    return {
      content: [{ type: 'text', text: 'Error: "path" parameter is required' }],
      isError: true,
    };
  }
  await ctx.fsManager.deleteFile(filePath, {
    recursive: args.recursive !== undefined ? Boolean(args.recursive) : true,
  });
  return {
    content: [{ type: 'text', text: `Deleted ${filePath}` }],
  };
}

export async function handleMakeDirectory(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const dirPath = String(args.path || '').trim();
  if (!dirPath) {
    return {
      content: [{ type: 'text', text: 'Error: "path" parameter is required' }],
      isError: true,
    };
  }
  await ctx.fsManager.makeDirectory(dirPath);
  return {
    content: [{ type: 'text', text: `Created directory ${dirPath}` }],
  };
}

export async function handleMoveFile(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const source = String(args.source || '').trim();
  const destination = String(args.destination || '').trim();
  if (!source || !destination) {
    return {
      content: [
        { type: 'text', text: 'Error: "source" and "destination" parameters are required' },
      ],
      isError: true,
    };
  }
  await ctx.fsManager.moveFile(source, destination);
  return {
    content: [{ type: 'text', text: `Moved ${source} to ${destination}` }],
  };
}

export async function handleCopyFile(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const source = String(args.source || '').trim();
  const destination = String(args.destination || '').trim();
  if (!source || !destination) {
    return {
      content: [
        { type: 'text', text: 'Error: "source" and "destination" parameters are required' },
      ],
      isError: true,
    };
  }
  await ctx.fsManager.copyFile(source, destination);
  return {
    content: [{ type: 'text', text: `Copied ${source} to ${destination}` }],
  };
}

export async function handleStatFile(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const filePath = String(args.path || '').trim();
  if (!filePath) {
    return {
      content: [{ type: 'text', text: 'Error: "path" parameter is required' }],
      isError: true,
    };
  }
  const data = await ctx.fsManager.executeAction('stat', { path: filePath });
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export async function handleBatchFs(
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  const ops = (args.operations as FsOperation[]) || [];
  if (!Array.isArray(ops) || ops.length === 0) {
    return {
      content: [{ type: 'text', text: 'Error: "operations" parameter must be a non-empty array' }],
      isError: true,
    };
  }
  const stopOnError = args.stopOnError !== undefined ? Boolean(args.stopOnError) : true;
  const res = await ctx.fsManager.executeBatch(ops, stopOnError, (cmd, cwd, timeoutMs) =>
    ctx.executor.executeCommand(cmd, cwd, timeoutMs),
  );
  return {
    content: [{ type: 'text', text: JSON.stringify(res, null, 2) }],
    isError: res.failed > 0,
  };
}
