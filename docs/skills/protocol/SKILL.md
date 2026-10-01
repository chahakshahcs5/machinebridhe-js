# Protocol skill

- Keep all wire messages in `packages/protocol`.
- Validate external JSON with Zod before routing.
- Preserve `requestId` for request/response correlation.
- Preserve `sessionId` on every terminal stream message.
- Keep protocol platform-neutral; never encode Unix-only assumptions into message names.
- Update `docs/PROTOCOL.md` and tests when adding or changing a message.
- Reject unknown or oversized messages rather than silently accepting arbitrary objects.
