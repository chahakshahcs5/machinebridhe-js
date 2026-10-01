# Testing skill

Every meaningful change should be checked at the narrowest useful level and then with the full suite.

```bash
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

For terminal/routing changes, run the Docker-backed acceptance flow. For native packaging changes, smoke-test the resulting executable on each target OS because `node-pty` contains native components.

Do not mark an infrastructure-dependent E2E test as passing merely because the test process starts. It must prove the client → Edge → Agent → PTY → Agent → Edge → client path.
