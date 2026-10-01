# Security

MachineBridge intentionally provides arbitrary command execution to an authorized client. Therefore the threat model treats the terminal as a highly privileged capability.

## Controls

### Device identity

Each installation generates an Ed25519 key pair. Only the public key is registered with Edge. The private key remains in the agent data directory.

### Replay protection

Agent hello messages contain a timestamp and cryptographically random nonce. Edge applies a configurable clock-skew window and remembers used `(machineId, nonce)` pairs for the replay window.

### Client authorization

Short-lived client tokens identify a client and user. Every device and terminal session is checked against that user before traffic is forwarded.

### Input validation

All WebSocket messages are validated with Zod. Dimensions, payload sizes, session IDs, and protocol message types are bounded.

### Backpressure

The Edge checks WebSocket `bufferedAmount`. The agent also limits accumulated PTY output bytes. A session is terminated instead of allowing unbounded memory growth.

### Secrets

Never log private keys, bearer tokens, authorization headers, environment variables, or terminal content. Use `.env` only for development and secret management infrastructure in production.

## Deployment guidance

Use HTTPS/WSS in production, rotate registration and client secrets, run the agent as a dedicated least-privilege OS user, restrict Edge ingress, protect PostgreSQL, and add distributed replay/rate-limit storage when multiple Edge replicas are deployed.

## Future approval layer

Authorization and policy are deliberately separate from PTY management. A future policy engine can decide whether a privileged terminal requires explicit user approval without modifying the PTY transport.
