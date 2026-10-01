import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyApiKey } from '@machinebridge/shared';
import { getBaseUrl } from './oauth.js';

export function extractApiKey(request: {
  headers: Record<string, string | string[] | undefined>;
  query?: unknown;
}): string | undefined {
  const xApiKey = request.headers['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey) {
    return xApiKey;
  }

  const authHeader = request.headers['authorization'];
  if (typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return match[1];
    }
  }

  const query = request.query as Record<string, unknown> | undefined;
  if (query) {
    if (typeof query.apiKey === 'string' && query.apiKey) {
      return query.apiKey;
    }
    if (typeof query.token === 'string' && query.token) {
      return query.token;
    }
  }

  return undefined;
}

const PUBLIC_PATHNAMES = new Set([
  '/health',
  '/ready',
  '/sse',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
  '/sse/.well-known/oauth-protected-resource',
  '/oauth/authorize',
  '/oauth/token',
  '/oauth/register',
  '/oauth/userinfo',
]);

export function makeAuthHook(
  expectedApiKey: string,
  isSessionAuthenticated?: (sessionId: string) => boolean,
) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply) {
    if (request.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', '*');
      return reply.code(204).send();
    }

    const pathname = request.url.split('?')[0];

    // Whitelist health and OAuth discovery / authorization endpoints
    if (
      PUBLIC_PATHNAMES.has(pathname) ||
      pathname.startsWith('/.well-known/') ||
      pathname.startsWith('/oauth/')
    ) {
      return;
    }

    // If request is to /messages:
    if (pathname === '/messages') {
      const parsedUrl = new URL(request.url, 'http://localhost');
      const sessionId = parsedUrl.searchParams.get('sessionId');
      if (sessionId && isSessionAuthenticated && isSessionAuthenticated(sessionId)) {
        return;
      }

      const providedKey = extractApiKey(request);
      if (verifyApiKey(expectedApiKey, providedKey)) {
        return;
      }

      // Allow MCP protocol handshake, discovery, and tool requests (which carry tool-level _meta challenge)
      const body = request.body as Record<string, unknown> | unknown[] | undefined;
      const isJsonRpcBatch = Array.isArray(body);
      const method =
        body && typeof body === 'object' && !Array.isArray(body)
          ? (body.method as string)
          : undefined;
      if (
        isJsonRpcBatch ||
        method === 'server/discover' ||
        method === 'initialize' ||
        method === 'notifications/initialized' ||
        method === 'tools/list' ||
        method === 'ping' ||
        method === 'tools/call'
      ) {
        return;
      }

      const baseUrl = getBaseUrl(request);
      reply.header(
        'WWW-Authenticate',
        `Bearer realm="machinebridge", error="invalid_token", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      );
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or missing API key' });
    }

    const providedKey = extractApiKey(request);
    if (!verifyApiKey(expectedApiKey, providedKey)) {
      const baseUrl = getBaseUrl(request);
      reply.header(
        'WWW-Authenticate',
        `Bearer realm="machinebridge", error="invalid_token", resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
      );
      return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Invalid or missing API key' });
    }
  };
}
