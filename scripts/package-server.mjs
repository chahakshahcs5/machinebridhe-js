import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const targets = process.env.PKG_TARGETS ?? 'node22-linux-x64,node22-linux-arm64,node22-macos-x64,node22-win-x64';
mkdirSync('release', { recursive: true });

execFileSync(
  process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  [
    'exec',
    'pkg',
    'apps/server/dist/main.js',
    '--targets',
    targets,
    '--output',
    'release/machinebridge-server',
  ],
  { stdio: 'inherit' },
);
