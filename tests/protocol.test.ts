import { decode, encode } from '@machinebridge/protocol';

describe('protocol', () => {
  it('round trips terminal input', () => {
    const message = {
      type: 'terminal.input' as const,
      sessionId: 'session-1',
      data: 'echo hello\r',
    };

    expect(decode(encode(message))).toEqual(message);
  });

  it('rejects invalid terminal dimensions', () => {
    expect(() =>
      decode(JSON.stringify({ type: 'terminal.resize', sessionId: 's', cols: 1, rows: 40 })),
    ).toThrow();
  });

  it('rejects unknown message types', () => {
    expect(() => decode(JSON.stringify({ type: 'unknown' }))).toThrow();
  });
});
