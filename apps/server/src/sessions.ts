import { createId } from '@machinebridge/shared';

export interface InMemorySession {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  status: 'starting' | 'running' | 'closing' | 'closed';
  bufferedOutput: string[];
  bufferedBytes: number;
  shell?: string;
  shellType?: 'powershell' | 'cmd' | 'sh';
}

const MAX_SESSION_OUTPUT_BYTES = 8 * 1024 * 1024; // 8 MiB per session

export class InMemorySessionStore {
  private readonly sessions = new Map<string, InMemorySession>();

  create(
    ttlSeconds: number = 3600,
    shell?: string,
    shellType?: 'powershell' | 'cmd' | 'sh',
  ): InMemorySession {
    const id = createId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    const session: InMemorySession = {
      id,
      createdAt: now,
      expiresAt,
      status: 'starting',
      bufferedOutput: [],
      bufferedBytes: 0,
      shell,
      shellType,
    };

    this.sessions.set(id, session);
    return session;
  }

  get(id: string): InMemorySession | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt.getTime() <= Date.now()) {
      session.status = 'closed';
    }
    return session;
  }

  setStatus(id: string, status: InMemorySession['status']): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = status;
    }
  }

  appendOutput(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.bufferedOutput.push(data);
      session.bufferedBytes += Buffer.byteLength(data, 'utf8');

      // Keep within MAX_SESSION_OUTPUT_BYTES using byte tracking, not chunk counts
      while (
        session.bufferedBytes > MAX_SESSION_OUTPUT_BYTES &&
        session.bufferedOutput.length > 1
      ) {
        const removed = session.bufferedOutput.shift();
        if (removed) {
          session.bufferedBytes -= Buffer.byteLength(removed, 'utf8');
        }
      }
    }
  }

  getOutput(id: string): string {
    const session = this.sessions.get(id);
    return session ? session.bufferedOutput.join('') : '';
  }

  clearOutput(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.bufferedOutput = [];
      session.bufferedBytes = 0;
    }
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  expireOld(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() <= now) {
        this.sessions.delete(id);
      }
    }
  }

  get activeCount(): number {
    let count = 0;
    const now = Date.now();
    for (const session of this.sessions.values()) {
      if (session.status !== 'closed' && session.expiresAt.getTime() > now) {
        count++;
      }
    }
    return count;
  }
}
