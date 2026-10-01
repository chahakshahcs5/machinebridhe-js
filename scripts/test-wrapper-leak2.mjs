import { PtyManager } from '../packages/pty/dist/index.js';
import { CommandExecutor } from '../apps/server/dist/executor.js';
import { InMemorySessionStore } from '../apps/server/dist/sessions.js';
import { handleExecuteCommands } from '../apps/server/dist/mcp/handlers/terminal.js';

async function main() {
  const ptyManager = new PtyManager();
  const sessions = new InMemorySessionStore();
  const executor = new CommandExecutor(ptyManager);
  const ctx = { ptyManager, sessions, executor, fsManager: null };

  const testCases = [
    ['throw "fatal error"'],
    ['Write-Error "test error"'],
    ['nonexistentcmd12345'],
  ];

  for (let i = 0; i < testCases.length; i++) {
    console.log(`\n=== CASE ${i + 1}: ${JSON.stringify(testCases[i])} ===`);
    try {
      const res = await handleExecuteCommands({
        commands: testCases[i],
        stopOnError: false,
      }, ctx);
      const parsed = JSON.parse(res.content[0].text);
      for (const r of parsed.results) {
        console.log(`[CMD]: ${r.command}`);
        console.log(`[EXIT]: ${r.exitCode}`);
        console.log(`[OUTPUT]:\n${r.output}`);
      }
    } catch (err) {
      console.error('Error:', err);
    }
  }

  ptyManager.closeAll();
  process.exit(0);
}

main().catch(console.error);
