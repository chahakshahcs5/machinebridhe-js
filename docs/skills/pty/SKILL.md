# PTY skill

- Use `node-pty`; do not replace interactive PTY behavior with `child_process.exec` or `spawn`.
- Keep PTY code transport-independent.
- Select shells by platform: `$SHELL`, `/bin/zsh` on macOS, `/bin/bash` fallback on Linux, and `COMSPEC` / PowerShell on Windows.
- Preserve stdin, streaming output, resize, signals and exit lifecycle.
- Never create an unbounded output buffer.
- Always close PTYs during session teardown and process shutdown.
- Add a harmless cross-platform PTY test for behavior changes.
