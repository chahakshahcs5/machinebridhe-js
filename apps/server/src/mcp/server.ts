import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOLS } from './schemas.js';
import type { McpContext, ToolExecutionResult } from './types.js';
import { handleExecuteCommand, handleExecuteCommands } from './handlers/terminal.js';
import {
  handleReadFile,
  handleWriteFile,
  handleListDirectory,
  handleDeleteFile,
  handleMakeDirectory,
  handleMoveFile,
  handleCopyFile,
  handleStatFile,
  handleBatchFs,
} from './handlers/filesystem.js';
import {
  handleCreateSession,
  handleSendInput,
  handleReadOutput,
  handleCloseSession,
} from './handlers/session.js';

export async function executeTool(
  name: string,
  args: Record<string, unknown> = {},
  ctx: McpContext,
): Promise<ToolExecutionResult> {
  try {
    switch (name) {
      case 'execute_command':
        return await handleExecuteCommand(args, ctx);

      case 'execute_commands':
        return await handleExecuteCommands(args, ctx);

      case 'read_file':
        return await handleReadFile(args, ctx);

      case 'write_file':
        return await handleWriteFile(args, ctx);

      case 'list_directory':
        return await handleListDirectory(args, ctx);

      case 'delete_file':
        return await handleDeleteFile(args, ctx);

      case 'make_directory':
        return await handleMakeDirectory(args, ctx);

      case 'move_file':
        return await handleMoveFile(args, ctx);

      case 'copy_file':
        return await handleCopyFile(args, ctx);

      case 'stat_file':
        return await handleStatFile(args, ctx);

      case 'batch_fs':
        return await handleBatchFs(args, ctx);

      case 'create_session':
        return await handleCreateSession(args, ctx);

      case 'send_input':
        return await handleSendInput(args, ctx);

      case 'read_output':
        return await handleReadOutput(args, ctx);

      case 'close_session':
        return await handleCloseSession(args, ctx);

      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error: ${msg}` }],
      isError: true,
    };
  }
}

export function createMcpServer(ctx: McpContext): Server {
  const server = new Server(
    {
      name: 'machinebridge-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: MCP_TOOLS.map((tool) => ({
        ...tool,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { name, arguments: rawArgs } = request.params;
    const args = (rawArgs as Record<string, unknown>) || {};

    if (ctx.isCallerAuthenticated && !ctx.isCallerAuthenticated(extra)) {
      return {
        content: [
          {
            type: 'text',
            text: 'Unauthorized: Missing or invalid credentials for MCP tool execution',
          },
        ],
        isError: true,
      };
    }

    const res = await executeTool(name, args, ctx);
    return {
      content: res.content,
      isError: res.isError,
    };
  });

  return server;
}
