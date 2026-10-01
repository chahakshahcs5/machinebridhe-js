import { Tunnel } from 'cloudflared';
import { killProcessTree } from '@machinebridge/pty';

export interface TunnelStartOptions {
  port: number;
  host?: string;
  token?: string;
  timeoutMs?: number;
}

export class TunnelManager {
  private activeTunnel?: Tunnel;
  private currentUrl: string | null = null;
  private tunnelPid = 0;

  constructor() {
    const cleanup = (): void => {
      this.stopSync();
    };
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  public get url(): string | null {
    return this.currentUrl;
  }

  public get pid(): number {
    return this.tunnelPid;
  }

  public get isRunning(): boolean {
    return Boolean(this.activeTunnel && this.currentUrl);
  }

  public async start(options: TunnelStartOptions): Promise<string> {
    if (this.activeTunnel) {
      if (this.currentUrl) return this.currentUrl;
      await this.stop();
    }

    const host = options.host || 'localhost';
    const port = options.port;
    const timeoutMs = options.timeoutMs ?? 45000;

    return new Promise<string>((resolve, reject) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.stop().catch(() => {});
          reject(
            new Error(
              `CLOUDFLARE_TUNNEL_TIMEOUT: Failed to obtain tunnel URL within ${timeoutMs}ms`,
            ),
          );
        }
      }, timeoutMs);

      try {
        const tunnelInstance = options.token
          ? Tunnel.withToken(options.token)
          : Tunnel.quick(`http://${host}:${port}`);

        this.activeTunnel = tunnelInstance;
        this.tunnelPid = tunnelInstance.process?.pid ?? 0;

        tunnelInstance.on('url', (url: string) => {
          this.currentUrl = url;
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve(url);
          }
        });

        tunnelInstance.on('error', (err: Error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            this.stop().catch(() => {});
            reject(err);
          }
        });

        tunnelInstance.on('exit', (code, signal) => {
          this.currentUrl = null;
          this.activeTunnel = undefined;
          this.tunnelPid = 0;
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            reject(
              new Error(
                `CLOUDFLARE_TUNNEL_EXITED: Process exited with code ${code}, signal ${signal}`,
              ),
            );
          }
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  public async stop(): Promise<void> {
    this.stopSync();
  }

  public stopSync(): void {
    if (this.tunnelPid) {
      killProcessTree(this.tunnelPid);
      this.tunnelPid = 0;
    }
    if (this.activeTunnel) {
      try {
        this.activeTunnel.stop();
      } catch {
        // ignore
      }
      this.activeTunnel = undefined;
    }
    this.currentUrl = null;
  }
}
