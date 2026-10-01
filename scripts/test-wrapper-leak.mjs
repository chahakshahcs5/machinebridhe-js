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
    // Case 1: Error in PowerShell
    ['Get-Item NonExistentFile12345'],
    // Case 2: Multi-line command or script block
    ['1..3 | ForEach-Object { $_ * 2 }'],
    // Case 3: Command with quotes and parentheses
    ['Write-Host "hello (world)"'],
    // Case 4: Native exe failure
    ['cmd.exe /c exit 1', 'echo after_failure'],
    // Case 5: Standard batch commands
    ['echo hello', 'echo world'],
    // Case 6: Execution within an existing session
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
        if (r.output.includes('__MB_') || r.output.includes('Console]::Out') || r.output.includes('$__mb_ec')) {
          console.error('*** LEAK DETECTED IN OUTPUT! ***');
        }
      }
    } catch (err) {
      console.error('Error:', err);
    }
  }

  ptyManager.closeAll();
  process.exit(0);
}

main().catch(console.error);
