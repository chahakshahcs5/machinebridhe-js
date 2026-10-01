# Security skill

- Treat terminal access as arbitrary command execution.
- Do not add shell-command blacklists as the primary security control.
- Keep private keys on the agent machine.
- Verify Ed25519 signatures, timestamps, payload hashes and replay nonces at Edge.
- Authorize every device/session operation against the authenticated user.
- Never log tokens, private keys, authorization headers, environment variables, or terminal content by default.
- Keep protocol and security errors safe for remote clients; detailed diagnostics stay server-side.
- New privileged capabilities require an explicit policy/approval boundary.
