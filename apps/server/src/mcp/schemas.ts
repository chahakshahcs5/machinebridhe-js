import type { Tool } from '@modelcontextprotocol/sdk/types.js';

export const MCP_TOOLS: Tool[] = [
  {
    name: 'execute_command',
    description:
      'Execute a shell command (e.g. bash, PowerShell, git, npm, docker, python) on the host machine using a real interactive PTY and return its output and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for the command execution.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Maximum time to wait for execution in milliseconds (default: 15000).',
        },
        shell: {
          type: 'string',
          description:
            'Optional shell executable to run the command in (e.g. powershell.exe, cmd.exe, /bin/bash).',
        },
        sessionId: {
          type: 'string',
          description:
            'Optional active terminal session ID to execute the command within persistent environment state.',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'execute_commands',
    description:
      'Execute a batch sequence of shell commands sequentially in a persistent terminal session with per-command status, exit code, and timing.',
    inputSchema: {
      type: 'object',
      properties: {
        commands: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of shell commands to execute sequentially.',
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for the batch execution.',
        },
        timeoutMs: {
          type: 'number',
          description: 'Total timeout in milliseconds for the entire batch (default: 30000).',
        },
        stopOnError: {
          type: 'boolean',
          description: 'Whether to stop immediately when a command fails (default: true).',
        },
        shell: {
          type: 'string',
          description:
            'Optional shell executable to run the commands in (e.g. powershell.exe, cmd.exe, /bin/bash).',
        },
        sessionId: {
          type: 'string',
          description:
            'Optional active terminal session ID to execute the commands within persistent environment state.',
        },
      },
      required: ['commands'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read the content of a file on the machine with optional offset/chunking and encoding support.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path of the file to read (absolute or relative to current directory).',
        },
        offset: {
          type: 'number',
          description: 'Optional byte offset to start reading from (default: 0).',
        },
        length: {
          type: 'number',
          description: 'Optional maximum bytes to read (default: 1048576 = 1 MiB).',
        },
        encoding: {
          type: 'string',
          enum: ['utf8', 'base64'],
          description: 'Encoding of returned content (default: utf8).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write, create, or append content to a file on the machine.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Target path to write to.',
        },
        content: {
          type: 'string',
          description: 'Content to write into the file.',
        },
        append: {
          type: 'boolean',
          description: 'If true, appends content to the existing file.',
        },
        encoding: {
          type: 'string',
          enum: ['utf8', 'base64'],
          description: 'Encoding of the content (default: utf8).',
        },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_directory',
    description:
      'List files and directories at the given path with metadata (size, isDirectory, mtime).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to list (default: current working directory).',
        },
        recursive: {
          type: 'boolean',
          description: 'If true, recursively lists files in subdirectories.',
        },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file or directory recursively.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to delete.',
        },
        recursive: {
          type: 'boolean',
          description: 'If true, deletes directories recursively (default: true).',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'make_directory',
    description: 'Create a directory (including parent directories if needed).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Directory path to create.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'move_file',
    description: 'Move or rename a file or directory on the machine.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Path of the file or directory to move.',
        },
        destination: {
          type: 'string',
          description: 'Destination path.',
        },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'copy_file',
    description: 'Copy a file or directory on the machine.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          description: 'Path of the file or directory to copy.',
        },
        destination: {
          type: 'string',
          description: 'Destination path.',
        },
      },
      required: ['source', 'destination'],
    },
  },
  {
    name: 'stat_file',
    description: 'Get metadata about a file or directory (size, mtime, isDirectory, isFile).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Path to check.',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'batch_fs',
    description: 'Execute a batch sequence of filesystem operations atomically or sequentially.',
    inputSchema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          description:
            'List of filesystem operations (read, write, mkdir, delete, move, copy, list).',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['write', 'read', 'mkdir', 'delete', 'move', 'copy', 'list'],
              },
              path: { type: 'string' },
              content: { type: 'string' },
              destination: { type: 'string' },
              recursive: { type: 'boolean' },
              offset: { type: 'number' },
              length: { type: 'number' },
            },
            required: ['type'],
          },
        },
        stopOnError: {
          type: 'boolean',
          description: 'Stop executing remaining operations if one fails (default: true).',
        },
      },
      required: ['operations'],
    },
  },
  {
    name: 'create_session',
    description:
      'Create a new interactive terminal session ID for streaming or multi-step interaction.',
    inputSchema: {
      type: 'object',
      properties: {
        ttlSeconds: {
          type: 'number',
          description: 'Session lifetime in seconds (default: 3600).',
        },
      },
    },
  },
  {
    name: 'send_input',
    description: 'Send input text or signals to an active interactive terminal session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The active session ID.',
        },
        data: {
          type: 'string',
          description: 'Data string to send to stdin.',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'read_output',
    description: 'Read the latest buffered output from an active interactive terminal session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The active session ID.',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'close_session',
    description: 'Close and terminate an active terminal session.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'The active session ID to close.',
        },
      },
      required: ['sessionId'],
    },
  },
];
