import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer, executeTool, MCP_TOOLS, type McpContext } from '../mcp/index.js';
import { extractApiKey } from '../auth.js';
import { verifyApiKey } from '@machinebridge/shared';
import { getBaseUrl } from '../oauth.js';

interface McpSseContext {
  transport: SSEServerTransport;
}

export function registerSseRoutes(
  app: FastifyInstance,
  options: {
    ctx: McpContext;
    apiKey: string;
    authenticatedSseSessionIds: Set<string>;
  },
): void {
  const { ctx, apiKey, authenticatedSseSessionIds } = options;
  const sseSessions = new Map<string, McpSseContext>();

  async function computeJsonRpcResponse(
    payload: Record<string, unknown>,
    request: FastifyRequest,
  ): Promise<Record<string, unknown> | undefined> {
    const baseUrl = getBaseUrl(request);
    const id = payload.id;
    const method = payload.method as string;
    const params = (payload.params as Record<string, unknown>) || {};

    // MCP 2026-07-28 server/discover specification
    if (method === 'server/discover') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          supportedVersions: ['2026-07-28', '2025-11-25', '2024-11-05'],
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: 'machinebridge-mcp',
            version: '1.0.0',
          },
          _meta: {
            'io.modelcontextprotocol/serverInfo': {
              name: 'machinebridge-mcp',
              version: '1.0.0',
            },
          },
          instructions: 'MachineBridge secure remote PTY system.',
        },
      };
    }

    // MCP initialize handshake
    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: (params.protocolVersion as string) || '2026-07-28',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'machinebridge-mcp',
            version: '1.0.0',
          },
        },
      };
    }

    // Notifications (no id)
    if (id === undefined || id === null) {
      return undefined;
    }

    // MCP ping
    if (method === 'ping') {
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };
    }

    // MCP tools/list
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS.map((tool) => ({
            ...tool,
            securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }],
            _meta: {
              securitySchemes: [{ type: 'oauth2', scopes: ['mcp'] }],
            },
          })),
        },
      };
    }

    // MCP tools/call
    if (method === 'tools/call') {
      const token = extractApiKey(request);
      const isAuthed = token ? verifyApiKey(apiKey, token) : false;

      if (!isAuthed) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: 'Authentication required: please log in to authorize MachineBridge tools.',
              },
            ],
            _meta: {
              'mcp/www_authenticate': [
                `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource", error="insufficient_scope", error_description="Authentication required"`,
              ],
            },
            isError: true,
          },
        };
      }

      const toolName = params.name as string;
      const toolArgs = (params.arguments as Record<string, unknown>) || {};
      const result = await executeTool(toolName, toolArgs, {
        ...ctx,
        getBaseUrl: () => baseUrl,
      });

      return {
        jsonrpc: '2.0',
        id,
        result,
      };
    }

    // Unknown method
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }

  app.all('/sse', async (request, reply) => {
    const query = (request.query as Record<string, string>) || {};
    const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const sessionId = parsedUrl.searchParams.get('sessionId') || query.sessionId;

    request.log.info(
      {
        method: request.method,
        headers: request.headers,
        query: request.query,
        body: request.body,
      },
      'Incoming /sse request',
    );

    // If POST /sse carries a JSON-RPC body directly (e.g. server/discover, tools/list, etc.)
    const body = request.body as Record<string, unknown> | unknown[] | undefined;
    if (request.method === 'POST' && body) {
      const isJsonRpc =
        Array.isArray(body) ||
        (typeof body === 'object' && ('jsonrpc' in body || 'method' in body));

      if (isJsonRpc) {
        reply.header('Access-Control-Allow-Origin', '*');
        reply.header(
          'mcp-protocol-version',
          (request.headers['mcp-protocol-version'] as string) || '2026-07-28',
        );

        if (Array.isArray(body)) {
          const results = (
            await Promise.all(
              body.map((item) => computeJsonRpcResponse(item as Record<string, unknown>, request)),
            )
          ).filter(Boolean);
          if (results.length === 0) {
            return reply.code(202).send();
          }
          return reply.code(200).send(results);
        }

        const result = await computeJsonRpcResponse(body as Record<string, unknown>, request);
        if (result === undefined) {
          return reply.code(202).send();
        }
        return reply.code(200).send(result);
      }
    }

    // If POST /sse carries a sessionId for an existing session, delegate to that session
    if (request.method === 'POST' && sessionId && sseSessions.has(sessionId)) {
      const session = sseSessions.get(sessionId)!;
      reply.hijack();
      reply.raw.setHeader('Access-Control-Allow-Origin', '*');
      return session.transport.handlePostMessage(request.raw, reply.raw, request.body);
    }

    // If POST /sse is an inspection probe (not asking for an event stream), return 200 immediately
    const acceptHeader = String(request.headers.accept || '');
    if (request.method === 'POST' && !acceptHeader.includes('text/event-stream')) {
      return reply.code(200).send({
        ok: true,
        transport: 'sse',
        endpoint: '/messages',
      });
    }

    reply.hijack();
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    reply.raw.setHeader('X-Accel-Buffering', 'no');

    const token = extractApiKey(request);
    const isAuthed = token ? verifyApiKey(apiKey, token) : false;
    const endpoint =
      isAuthed && (query.apiKey || query.token)
        ? `/messages?apiKey=${encodeURIComponent(token!)}`
        : '/messages';

    const mcpServer = createMcpServer({
      ...ctx,
      isCallerAuthenticated: (extra?: unknown) => {
        if (authenticatedSseSessionIds.has(transport.sessionId)) {
          return true;
        }
        const headers = (extra as { requestInfo?: { headers?: Record<string, string> } })
          ?.requestInfo?.headers;
        if (headers) {
          const authHeader = headers['authorization'];
          if (typeof authHeader === 'string') {
            const match = authHeader.match(/^Bearer\s+(.+)$/i);
            if (match?.[1] && verifyApiKey(apiKey, match[1])) {
              authenticatedSseSessionIds.add(transport.sessionId);
              return true;
            }
          }
          const xApiKey = headers['x-api-key'];
          if (typeof xApiKey === 'string' && verifyApiKey(apiKey, xApiKey)) {
            authenticatedSseSessionIds.add(transport.sessionId);
            return true;
          }
        }
        return false;
      },
      getBaseUrl: () => getBaseUrl(request),
    });
    const transport = new SSEServerTransport(endpoint, reply.raw);
    sseSessions.set(transport.sessionId, { transport });
    if (isAuthed) {
      authenticatedSseSessionIds.add(transport.sessionId);
    }

    try {
      await mcpServer.connect(transport);
      // Immediately flush headers and ping to punch through Cloudflare reverse proxy buffers
      if (typeof reply.raw.flushHeaders === 'function') {
        reply.raw.flushHeaders();
      }
      reply.raw.write(': ping\n\n');
      (reply.raw as unknown as { flush?: () => void }).flush?.();
    } catch (err) {
      request.log.error({ err }, 'Failed to establish MCP SSE connection');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify({ error: 'Failed to establish SSE connection' }));
      }
      return;
    }

    // Keep-alive ping every 15s to keep the SSE stream active
    const keepAliveInterval = setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) {
        reply.raw.write(': keep-alive\n\n');
        (reply.raw as unknown as { flush?: () => void }).flush?.();
      }
    }, 15000);

    reply.raw.on('close', () => {
      clearInterval(keepAliveInterval);
      sseSessions.delete(transport.sessionId);
      authenticatedSseSessionIds.delete(transport.sessionId);
    });
  });

  app.post('/messages', async (request, reply) => {
    const parsedUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    const sessionId = parsedUrl.searchParams.get('sessionId');

    // If POST /messages carries a JSON-RPC body directly without sessionId
    const body = request.body as Record<string, unknown> | unknown[] | undefined;
    const isJsonRpc =
      Array.isArray(body) || (typeof body === 'object' && ('jsonrpc' in body || 'method' in body));

    if (!sessionId && isJsonRpc) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header(
        'mcp-protocol-version',
        (request.headers['mcp-protocol-version'] as string) || '2026-07-28',
      );

      if (Array.isArray(body)) {
        const results = (
          await Promise.all(
            body.map((item) => computeJsonRpcResponse(item as Record<string, unknown>, request)),
          )
        ).filter(Boolean);
        if (results.length === 0) {
          return reply.code(202).send();
        }
        return reply.code(200).send(results);
      }

      const result = await computeJsonRpcResponse(body as Record<string, unknown>, request);
      if (result === undefined) {
        return reply.code(202).send();
      }
      return reply.code(200).send(result);
    }

    if (!sessionId) {
      return reply.code(400).send({ error: 'Missing sessionId parameter' });
    }
    const session = sseSessions.get(sessionId);
    if (!session) {
      return reply.code(404).send({ error: 'Session not found or expired' });
    }

    const token = extractApiKey(request);
    if (token && verifyApiKey(apiKey, token)) {
      authenticatedSseSessionIds.add(sessionId);
    }

    reply.hijack();
    reply.raw.setHeader('Access-Control-Allow-Origin', '*');
    try {
      await session.transport.handlePostMessage(request.raw, reply.raw, request.body);
    } catch (err) {
      request.log.error({ err }, 'Failed to handle SSE message');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify({ error: 'Failed to process message' }));
      }
    }
  });
}
