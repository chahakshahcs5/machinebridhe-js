#!/usr/bin/env node

import Fastify from 'fastify';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '@machinebridge/config';
import { PtyManager } from '@machinebridge/pty';
import { FilesystemManager } from '@machinebridge/fs';
import { InMemorySessionStore } from './sessions.js';
import { CommandExecutor } from './executor/index.js';
import { makeAuthHook } from './auth.js';
import { createMcpServer, type McpContext } from './mcp/index.js';
import { TunnelManager } from '@machinebridge/tunnel';
import { OAuthStore } from './oauth.js';
import {
  registerHealthRoutes,
  registerTerminalRoutes,
  registerFsRoutes,
  registerToolsRoutes,
  registerOAuthRoutes,
  registerSseRoutes,
  setupTerminalWebSocket,
} from './routes/index.js';

const config = loadConfig();
const ptyManager = new PtyManager(
  config.MACHINEBRIDGE_MAX_SESSIONS,
  config.MACHINEBRIDGE_MAX_BUFFER_BYTES,
);
const fsManager = new FilesystemManager();
const sessions = new InMemorySessionStore();
const executor = new CommandExecutor(ptyManager);
const tunnelManager = new TunnelManager();

const cliArgs = process.argv.slice(2);
const isStdio = cliArgs.includes('--stdio');

async function runStdio(): Promise<void> {
  const mcpServer = createMcpServer({ executor, fsManager, sessions, ptyManager });
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  process.stderr.write('[MachineBridge Server] Running in MCP stdio mode\n');

  const cleanupAndExit = (): void => {
    ptyManager.closeAll();
    process.exit(0);
  };

  process.stdin.on('close', cleanupAndExit);
  process.stdin.on('end', cleanupAndExit);
  process.once('SIGINT', cleanupAndExit);
  process.once('SIGTERM', cleanupAndExit);
  process.once('exit', () => ptyManager.closeAll());
}

export async function buildApp(customConfig?: Partial<typeof config>) {
  const effectiveConfig = { ...config, ...customConfig };
  const app = Fastify({ logger: effectiveConfig.NODE_ENV !== 'test' });
  const apiKey = effectiveConfig.MACHINEBRIDGE_API_KEY;
  const oauthStore = new OAuthStore();
  const authenticatedSseSessionIds = new Set<string>();

  // Support URL-encoded forms for OAuth standard token and authorize requests
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      try {
        const params = new URLSearchParams(body);
        const parsed: Record<string, string> = {};
        for (const [key, value] of params.entries()) {
          parsed[key] = value;
        }
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Handle application/json gracefully even if body is empty
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      if (!body || !body.trim()) {
        return done(null, {});
      }
      try {
        done(null, JSON.parse(body));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Accept any content-type (text/plain, octet-stream, etc.) to prevent 415 errors
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body: string, done) => {
    if (typeof body === 'string' && (body.trim().startsWith('{') || body.trim().startsWith('['))) {
      try {
        return done(null, JSON.parse(body));
      } catch {
        // keep as string
      }
    }
    done(null, body || {});
  });

  // Global preHandler auth hook
  app.addHook(
    'preHandler',
    makeAuthHook(apiKey, (id) => authenticatedSseSessionIds.has(id)),
  );

  const mcpContext: McpContext = {
    executor,
    fsManager,
    sessions,
    ptyManager,
  };

  // Register modular route plugins
  registerHealthRoutes(app, tunnelManager);
  registerTerminalRoutes(app, { executor, sessions, ptyManager, config: effectiveConfig });
  registerFsRoutes(app, { fsManager, executor });
  registerToolsRoutes(app, mcpContext);
  registerOAuthRoutes(app, { apiKey, oauthStore });
  registerSseRoutes(app, { ctx: mcpContext, apiKey, authenticatedSseSessionIds });
  setupTerminalWebSocket(app, { ptyManager, sessions, apiKey, config: effectiveConfig });

  return {
    app,
    apiKey,
    oauthStore,
    authenticatedSseSessionIds,
    ptyManager,
    fsManager,
    sessions,
    executor,
    tunnelManager,
  };
}

async function runHttp(): Promise<void> {
  const { app, apiKey } = await buildApp();
  const address = await app.listen({ host: config.EDGE_HOST, port: config.EDGE_PORT });
  app.log.info({ address, apiKey }, 'MachineBridge Unified Server running');

  if (config.MACHINEBRIDGE_EXPOSE_TUNNEL) {
    try {
      app.log.info('Exposing port via Cloudflare Tunnel...');
      const publicUrl = await tunnelManager.start({
        port: config.EDGE_PORT,
        token: config.MACHINEBRIDGE_TUNNEL_TOKEN,
      });
      console.log(`\n[MachineBridge Tunnel] Public HTTPS URL: ${publicUrl}`);
      console.log(
        `[MachineBridge Tunnel] Note: If your local ISP blocks *.trycloudflare.com, set DNS to 1.1.1.1 / 8.8.8.8 or enable Secure DNS in your browser.\n`,
      );
    } catch (err) {
      app.log.error(err, 'Failed to establish Cloudflare Tunnel');
      console.error('[MachineBridge Tunnel] Error establishing tunnel:', err);
    }
  }

  // Background cleanup timer for expired sessions
  const cleanupTimer = setInterval(() => sessions.expireOld(), 60_000);
  cleanupTimer.unref();

  const shutdown = async (): Promise<void> => {
    clearInterval(cleanupTimer);
    tunnelManager.stopSync();
    ptyManager.closeAll();
    await app.close();
  };

  process.once('exit', () => {
    tunnelManager.stopSync();
    ptyManager.closeAll();
  });
  process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
  process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
  if (process.platform !== 'win32') {
    process.once('SIGHUP', () => void shutdown().finally(() => process.exit(0)));
  }
}

if (process.env.NODE_ENV !== 'test') {
  if (isStdio) {
    runStdio().catch((error: unknown) => {
      process.stderr.write(
        `[MachineBridge Server] Fatal stdio error: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    });
  } else {
    runHttp().catch((error: unknown) => {
      console.error('[MachineBridge Server] Failed to start:', error);
      process.exit(1);
    });
  }
}
