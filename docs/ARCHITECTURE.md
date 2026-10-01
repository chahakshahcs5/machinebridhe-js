# MachineBridge (Node.js / TypeScript) — Architecture

## Overview

This document outlines the architecture for the **MachineBridge** TypeScript/Node.js implementation and companion SDK. It is structured as a unified server application backed by modular, decoupled packages. It eliminates multi-daemon deployment complexity, PostgreSQL runtime dependencies, and separate proxy tiers while preserving clear architectural boundaries.

> **Canonical Engine**: For the high-performance native C++20 core engine, see `machinebridge-cpp`.

```text
  MCP Client (Claude / Cursor)         HTTP Client / AI Agent / Browser
               │                                      │
               │ Stdio / SSE                          │ REST / WebSocket
               ▼                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      MachineBridge Unified Server                      │
│                                                                        │
│   Fastify HTTP App  ───  Timing-Safe API Key Auth Hook (X-API-Key)     │
│   MCP Server        ───  Tool Router & Dispatcher                      │
│   WebSocket Server  ───  Raw Terminal Interactive Streaming            │
│   In-Memory Sessions───  Active Session Lifecycle & Buffer Store       │
│   Command Executor  ───  PTY Execution Engine & Exit Code Matcher      │
└────────────────────────────────────────────────────────────────────────┘
              │                                      │
              ▼                                      ▼
       @machinebridge/pty                     @machinebridge/fs
    (node-pty + Process Tree Kill)         (Path Confinement & Guards)
              │                                      │
              ▼                                      ▼
    Interactive OS Shell (PTY)                 Host Filesystem
    (PowerShell / CMD / Bash / Zsh)
```

---

## Modular Packages

1. **`@machinebridge/pty`**
   - Owns native `node-pty` process lifecycle.
   - Cross-platform shell detection (PowerShell, CMD, Bash, Zsh).
   - Process tree termination via `taskkill /F /T /PID` (Windows) and process group `SIGKILL` / `pkill -P` (POSIX).
   - Buffer overflow enforcement and error normalization.

2. **`@machinebridge/fs`**
   - Owns filesystem operations (`read`, `write`, `stat`, `copy`, `move`, `delete`, `mkdir`, `list`, `batch`).
   - Path traversal guards and workspace confinement enforcement.
   - Protection against reserved Windows device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`).
   - Supports atomic and sequential multi-operation batching.

3. **`@machinebridge/protocol`**
   - Strict TypeScript types and Zod schemas for wire protocol messages.
   - Binary serialization and framing (`encode`, `decode`).

4. **`@machinebridge/crypto`**
   - Ed25519 signing and verification utilities.
   - Timing-safe comparison helpers.

5. **`@machinebridge/shared`**
   - Timing-safe API key verification.
   - Markdown and JSON output formatters for batch operations.

6. **`@machinebridge/config`**
   - Environment validation and configuration loader (`MACHINEBRIDGE_API_KEY`, ports, buffer limits, tunnel flags).

7. **`@machinebridge/tunnel`**
   - Encapsulates Cloudflare Tunnel management using `cloudflared`.
   - Supports quick zero-configuration tunnels and token-authenticated tunnels.
   - Tied directly to `killProcessTree` so all child daemon processes terminate on server exit.

---

## Applications

1. **`apps/server`**
   - Unified entry point hosting:
     - **MCP Server**: Stdio transport (`--stdio`) and SSE transport (`/sse`, `/messages`).
     - **REST Tool Execution**: `/tools`, `/tools/:name`, `/v1/tools/:name`.
     - **REST Terminal Execution**: `/v1/terminal/execute`, `/v1/terminal/execute-batch`.
     - **REST Filesystem API**: `/v1/fs/read`, `/v1/fs/write`, `/v1/fs/batch`, etc.
     - **Interactive Terminal WebSocket**: `WSS /v1/terminal/sessions/:id`.
     - **In-Memory Session Store**: Fast, self-contained, with zero external database dependencies.

2. **`apps/cli`**
   - Standalone reference terminal client for connecting to the server over WebSocket.

---

## Process Tree & Failure Handling

- **Child Process Tree Termination**: When sessions close or the server exits, `taskkill /F /T` (Windows) or `SIGKILL` process groups (POSIX) kill the shell and all spawned sub-processes (e.g. dev servers, compilers, long-running processes).
- **Graceful Shutdown**: Hooks on `exit`, `SIGINT`, `SIGTERM`, `SIGHUP`, and `stdin.close` guarantee cleanup.
- **PTY Buffer Limits**: Terminal output buffering is bounded to prevent unbounded memory growth.
- **Timing-Safe Auth**: All requests verify API keys using constant-time comparisons (`crypto.timingSafeEqual`).
