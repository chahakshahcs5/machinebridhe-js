import type { FastifyInstance } from 'fastify';
import type { TunnelManager } from '@machinebridge/tunnel';

export function registerHealthRoutes(app: FastifyInstance, tunnelManager: TunnelManager): void {
  app.get('/health', async () => ({
    ok: true,
    service: 'machinebridge-unified',
    tunnelUrl: tunnelManager.url,
  }));

  app.get('/ready', async () => ({
    ok: true,
    status: 'ready',
    tunnelUrl: tunnelManager.url,
  }));
}
