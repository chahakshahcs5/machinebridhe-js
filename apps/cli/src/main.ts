#!/usr/bin/env node

import { loadConfig } from '@machinebridge/config';
import { WebSocket } from 'ws';

const config = loadConfig();
const args = process.argv.slice(2);
const command = args[0];

function flag(name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback;
}

const server = flag('--server', process.env.MACHINEBRIDGE_EDGE_URL ?? 'http://localhost:8080')!;
const userId = flag('--user', process.env.MACHINEBRIDGE_USER_ID ?? 'dev-user')!;
const apiKey = flag(
  '--api-key',
  process.env.MACHINEBRIDGE_API_KEY || config.MACHINEBRIDGE_API_KEY || '',
)!;
const clientSecret = flag(
  '--client-secret',
  process.env.EDGE_CLIENT_SECRET || config.EDGE_CLIENT_SECRET || '',
);

async function requestJson(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${server.replace(/\/$/, '')}${path}`, init);
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function shell(): Promise<void> {
  let websocketUrl: string;
  let sessionId: string;

  if (apiKey) {
    // Direct connection to Unified Server with API Key
    const session = await requestJson('/v1/terminal/sessions', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'content-type': 'application/json',
      },
    });

    sessionId = String(session.sessionId);
    const websocketPath = String(session.websocketPath);
    websocketUrl = `${server.replace(/^http/, 'ws').replace(/\/$/, '')}${websocketPath}?apiKey=${encodeURIComponent(apiKey)}`;
  } else if (clientSecret) {
    // Legacy multi-tier flow
    const tokenResponse = await requestJson('/v1/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: 'machinebridge-cli', clientSecret, userId }),
    });
    const accessToken = String(tokenResponse.accessToken);

    const devices = (await requestJson('/v1/devices', {
      headers: { authorization: `Bearer ${accessToken}` },
    })) as unknown as { id: string; status: string; name: string }[];
    const requestedDeviceId = flag('--device');
    const device = requestedDeviceId
      ? devices.find((candidate) => candidate.id === requestedDeviceId)
      : devices.find((candidate) => candidate.status === 'online');

    if (!device || device.status !== 'online') throw new Error('No online authorized device found');

    const session = await requestJson('/v1/terminal/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ deviceId: device.id }),
    });

    sessionId = String(session.sessionId);
    const websocketPath = String(session.websocketPath);
    websocketUrl = `${server.replace(/^http/, 'ws').replace(/\/$/, '')}${websocketPath}?token=${encodeURIComponent(accessToken)}`;
  } else {
    throw new Error('Missing --api-key or MACHINEBRIDGE_API_KEY');
  }

  const websocket = new WebSocket(websocketUrl);
  const cols = process.stdout.columns ?? 120;
  const rows = process.stdout.rows ?? 40;
  let exiting = false;

  const cleanup = (): void => {
    if (exiting) return;
    exiting = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    websocket.close();
  };

  websocket.on('open', () => {
    websocket.send(
      JSON.stringify({
        type: 'terminal.create',
        requestId: sessionId,
        cols,
        rows,
        shell: null,
        cwd: process.cwd(),
      }),
    );

    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (chunk) => {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.send(
          JSON.stringify({
            type: 'terminal.input',
            sessionId,
            data: chunk.toString(),
          }),
        );
      }
    });
  });

  websocket.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as {
      type: string;
      data?: string;
      code?: string;
      message?: string;
    };
    if (message.type === 'terminal.output') process.stdout.write(message.data ?? '');
    if (message.type === 'terminal.closed') cleanup();
    if (message.type === 'error') {
      process.stderr.write(`\n[MachineBridge] ${message.code}: ${message.message}\n`);
      cleanup();
    }
  });

  websocket.on('close', cleanup);
  websocket.on('error', (error) => {
    process.stderr.write(`\n[MachineBridge] ${error.message}\n`);
    cleanup();
  });

  process.stdout.on('resize', () => {
    if (websocket.readyState !== WebSocket.OPEN) return;
    websocket.send(
      JSON.stringify({
        type: 'terminal.resize',
        sessionId,
        cols: process.stdout.columns ?? 120,
        rows: process.stdout.rows ?? 40,
      }),
    );
  });

  process.once('SIGINT', () => {
    if (websocket.readyState === WebSocket.OPEN) {
      websocket.send(
        JSON.stringify({
          type: 'terminal.signal',
          sessionId,
          signal: 'SIGINT',
        }),
      );
    }
  });
}

async function main(): Promise<void> {
  if (command === 'shell') {
    await shell();
    return;
  }
  console.log(
    'Usage: machinebridge shell [--server URL] [--user USER_ID] [--device DEVICE_ID] [--client-secret SECRET]',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
