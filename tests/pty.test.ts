import { PtyManager, killProcessTree } from '@machinebridge/pty';

describe('PtyManager', () => {
  it('runs a harmless command and streams output', async () => {
    const manager = new PtyManager(2, 1024 * 1024);
    let output = '';

    await new Promise<void>((resolve, reject) => {
      try {
        manager
          .create(
            { id: 'test-session', cols: 80, rows: 24, cwd: process.cwd() },
            {
              onData: (data) => {
                output += data;
                if (output.includes('machinebridge-test')) resolve();
              },
              onExit: () => undefined,
              onError: reject,
            },
          )
          .write(
            process.platform === 'win32'
              ? 'echo machinebridge-test\r'
              : 'echo machinebridge-test\r',
          );
      } catch (error) {
        reject(error);
      }
    });

    expect(output).toContain('machinebridge-test');
    manager.closeAll();
  }, 10_000);

  it('safely handles killProcessTree on non-existent or zero PIDs', () => {
    expect(() => killProcessTree(0)).not.toThrow();
    expect(() => killProcessTree(-1)).not.toThrow();
    expect(() => killProcessTree(9999999)).not.toThrow();
  });

  it('cleans up all sessions and process trees on closeAll()', () => {
    const manager = new PtyManager(5, 1024 * 1024);
    const session = manager.create(
      { id: 'cleanup-session', cols: 80, rows: 24 },
      { onData: () => undefined, onExit: () => undefined },
    );
    expect(session.pid).toBeGreaterThan(0);
    expect(manager.get('cleanup-session')).toBeDefined();

    manager.closeAll();
    expect(manager.get('cleanup-session')).toBeUndefined();
  });
});
