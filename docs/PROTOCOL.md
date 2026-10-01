# Protocol v1

Messages are JSON over WebSocket. Every message contains a `type`; request/response operations additionally use `requestId`.

## Agent authentication

The first agent message is:

```json
{
  "type": "device.hello",
  "machineId": "...",
  "timestamp": 1750000000,
  "nonce": "...",
  "requestId": "...",
  "payloadHash": "sha256 hex",
  "signature": "base64url"
}
```

The signed value is:

```text
machineId.timestamp.nonce.requestId.payloadHash
```

The payload hash covers the canonical JSON body `{type, machineId}`. Edge rejects unknown devices, stale timestamps, replayed nonces, mismatched hashes, and invalid signatures.

## Terminal lifecycle

Client sends:

```json
{
  "type": "terminal.create",
  "requestId": "session-id",
  "cols": 120,
  "rows": 40,
  "shell": null,
  "cwd": "/workspace"
}
```

Agent returns:

```json
{
  "type": "terminal.created",
  "requestId": "session-id",
  "sessionId": "session-id",
  "pid": 1234
}
```

Input:

```json
{ "type": "terminal.input", "sessionId": "session-id", "data": "npm test\r" }
```

Output:

```json
{ "type": "terminal.output", "sessionId": "session-id", "data": "..." }
```

Resize:

```json
{ "type": "terminal.resize", "sessionId": "session-id", "cols": 160, "rows": 50 }
```

Signal:

```json
{ "type": "terminal.signal", "sessionId": "session-id", "signal": "SIGINT" }
```

Close:

```json
{ "type": "terminal.close", "sessionId": "session-id" }
```

## Limits

Default limits are intentionally finite:

- input/output message: 1 MiB
- terminal columns: 20–500
- terminal rows: 5–200
- PTY output buffer: 4 MiB per session
- active PTY sessions: 8 per agent

## Error model

The protocol uses safe error codes such as `UNAUTHORIZED`, `FORBIDDEN`, `DEVICE_OFFLINE`, `SESSION_NOT_FOUND`, `PTY_START_FAILED`, `INVALID_MESSAGE`, `RATE_LIMITED`, and `MESSAGE_TOO_LARGE`.
