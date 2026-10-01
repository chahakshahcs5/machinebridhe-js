# MachineBridge agent instructions

MachineBridge is a secure remote PTY system. Before changing code:

1. Read `docs/ARCHITECTURE.md`.
2. Read the relevant skill under `docs/skills/`.
3. Keep PTY, protocol, transport, persistence, and authorization concerns separated.
4. Use strict TypeScript and validate all external input.
5. Do not replace PTY behavior with command-specific APIs.
6. Run `pnpm build`, `pnpm test`, `pnpm lint`, and `pnpm format:check` when dependencies are installed.
7. For infrastructure-dependent tests, report the exact prerequisites and do not claim unexecuted E2E coverage.
8. Do not weaken security controls just to make a test pass.
