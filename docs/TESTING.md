# Testing and acceptance

## Automated checks

```bash
pnpm build
pnpm test
pnpm lint
pnpm format:check
```

The PTY test executes a harmless echo command. Protocol, crypto and replay tests do not require PostgreSQL.

## Infrastructure test

Start the stack:

```bash
docker compose up --build
```

Then run a host agent and the reference CLI as described in the root README.

## Acceptance flow

1. Start PostgreSQL.
2. Start Edge.
3. Register the agent.
4. Start the agent and confirm the outbound WSS connection.
5. Start the CLI.
6. Authenticate and select the registered machine.
7. Create a terminal session.
8. Receive the shell prompt.
9. Run `echo "Hello MachineBridge"` and verify the output.
10. Run `pwd` and `node --version`.
11. Run an interactive program.
12. Send stdin.
13. Resize the terminal.
14. Send Ctrl+C.
15. Close the terminal.
16. Confirm the PTY has exited.
17. Stop the agent.
18. Confirm Edge reports the device offline.
19. Restart the agent.
20. Confirm automatic reconnect.
21. Create another session and repeat a harmless command.

## Security cases

Verify that each case is rejected:

- invalid client secret
- expired client token
- invalid device signature
- stale device timestamp
- replayed device nonce
- unknown machine ID
- wrong user's device
- cross-user session access
- expired session
- mismatched session ID
- malformed protocol message
- oversized WebSocket payload
- terminal session limit exceeded
- authentication rate limit exceeded

## Native executable verification

Build separately for each target OS. On every target, smoke-test:

```text
machinebridge-agent doctor
machinebridge-agent status
machinebridge-agent register ...
machinebridge-agent start
machinebridge shell ...
```

Native `node-pty` behavior must be tested on the target operating system; an executable produced for another OS is not a substitute for that test.
