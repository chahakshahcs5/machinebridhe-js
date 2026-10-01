import { TunnelManager } from '@machinebridge/tunnel';
import { loadConfig } from '@machinebridge/config';

describe('Cloudflare Tunnel Manager & Config', () => {
  describe('Config Schema for Tunnel', () => {
    it('defaults MACHINEBRIDGE_EXPOSE_TUNNEL to false', () => {
      const config = loadConfig({});
      expect(config.MACHINEBRIDGE_EXPOSE_TUNNEL).toBe(false);
      expect(config.MACHINEBRIDGE_TUNNEL_TOKEN).toBeUndefined();
    });

    it('parses MACHINEBRIDGE_EXPOSE_TUNNEL string values as boolean', () => {
      expect(loadConfig({ MACHINEBRIDGE_EXPOSE_TUNNEL: 'true' }).MACHINEBRIDGE_EXPOSE_TUNNEL).toBe(
        true,
      );
      expect(loadConfig({ MACHINEBRIDGE_EXPOSE_TUNNEL: '1' }).MACHINEBRIDGE_EXPOSE_TUNNEL).toBe(
        true,
      );
      expect(loadConfig({ MACHINEBRIDGE_EXPOSE_TUNNEL: 'yes' }).MACHINEBRIDGE_EXPOSE_TUNNEL).toBe(
        true,
      );
      expect(loadConfig({ MACHINEBRIDGE_EXPOSE_TUNNEL: 'false' }).MACHINEBRIDGE_EXPOSE_TUNNEL).toBe(
        false,
      );
      expect(loadConfig({ MACHINEBRIDGE_EXPOSE_TUNNEL: '0' }).MACHINEBRIDGE_EXPOSE_TUNNEL).toBe(
        false,
      );
    });

    it('parses custom MACHINEBRIDGE_TUNNEL_TOKEN', () => {
      const config = loadConfig({
        MACHINEBRIDGE_EXPOSE_TUNNEL: 'true',
        MACHINEBRIDGE_TUNNEL_TOKEN: 'eyJhIjoiY2xvdWRmbGFyZS10ZXN0LXRva2VuIn0=',
      });
      expect(config.MACHINEBRIDGE_EXPOSE_TUNNEL).toBe(true);
      expect(config.MACHINEBRIDGE_TUNNEL_TOKEN).toBe('eyJhIjoiY2xvdWRmbGFyZS10ZXN0LXRva2VuIn0=');
    });
  });

  describe('TunnelManager', () => {
    it('initializes in inactive state', () => {
      const manager = new TunnelManager();
      expect(manager.isRunning).toBe(false);
      expect(manager.url).toBeNull();
      expect(manager.pid).toBe(0);
    });

    it('safe stop operations on unstarted tunnel', async () => {
      const manager = new TunnelManager();
      expect(() => manager.stopSync()).not.toThrow();
      await expect(manager.stop()).resolves.toBeUndefined();
      expect(manager.url).toBeNull();
      expect(manager.isRunning).toBe(false);
    });
  });
});
