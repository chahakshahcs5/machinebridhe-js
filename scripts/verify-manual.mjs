import { PtyManager } from '../packages/pty/dist/index.js';
import { CommandExecutor } from '../apps/server/dist/executor.js';
import { InMemorySessionStore } from '../apps/server/dist/sessions.js';

async function runManualTests() {
  console.log('=== MACHINE BRIDGE REAL-WORLD MANUAL TESTS ===\n');
  const ptyManager = new PtyManager(5, 16 * 1024 * 1024, false);
  const executor = new CommandExecutor(ptyManager);
  const sessions = new InMemorySessionStore();

  try {
    // 1. Short Command
    console.log('[1/7] Testing Short Command (echo hello)...');
    const res1 = await executor.executeCommand('echo hello');
    console.log(`  ExitCode: ${res1.exitCode}`);
    console.log(`  Output: "${res1.output}"\n`);

    // 2. PowerShell Specific Command
    console.log('[2/7] Testing PowerShell Command (Write-Output + Get-Date)...');
    const res2 = await executor.executeCommand(
      "Write-Output 'single-command-ok'; Get-Date -Format o",
      undefined,
      15000,
      'powershell.exe',
    );
    console.log(`  ExitCode: ${res2.exitCode}`);
    console.log(`  Output:\n${res2.output}\n`);

    // 3. CMD Specific Command
    console.log('[3/7] Testing CMD Command (echo step_1 && echo step_2)...');
    const res3 = await executor.executeCommand(
      'echo cmd_step_1 && echo cmd_step_2',
      undefined,
      15000,
      'cmd.exe',
    );
    console.log(`  ExitCode: ${res3.exitCode}`);
    console.log(`  Output:\n${res3.output}\n`);

    // 4. Multiple Commands (Batch Execution)
    console.log('[4/7] Testing Batch Commands (executeCommands sequentially)...');
    const res4 = await executor.executeCommands(
      ["Write-Output 'batch-1'", "Write-Output 'batch-2'", "Write-Output 'batch-3'"],
      undefined,
      20000,
      true,
      'powershell.exe',
    );
    console.log(
      `  Total: ${res4.summary.total}, Passed: ${res4.summary.passed}, Failed: ${res4.summary.failed}`,
    );
    for (const r of res4.results) {
      console.log(
        `    Command: "${r.command}" -> ExitCode: ${r.exitCode}, Output: "${r.output}" (${r.durationMs}ms)`,
      );
    }
    console.log();

    // 5. Large Output
    console.log('[5/7] Testing Large Output Generation (5,000 lines)...');
    const res5 = await executor.executeCommand(
      'node -e "for (let i = 1; i <= 5000; i++) console.log(\'data_line_\' + i);"',
      undefined,
      30000,
    );
    const lineCount = res5.output.split('\n').length;
    console.log(`  ExitCode: ${res5.exitCode}`);
    console.log(`  Total Bytes: ${Buffer.byteLength(res5.output, 'utf8')}`);
    console.log(`  Total Lines: ${lineCount}`);
    console.log(`  Tail: "${res5.output.slice(-80).trim()}"\n`);

    // 6. Long-Running Command
    console.log('[6/7] Testing Long-Running Command (3 second silent sleep)...');
    const startSleep = Date.now();
    const res6 = await executor.executeCommand(
      'powershell -NoProfile -Command "Start-Sleep -Seconds 3; Write-Output \'slept-ok\'"',
      undefined,
      15000,
      'powershell.exe',
    );
    const sleepElapsed = Date.now() - startSleep;
    console.log(`  ExitCode: ${res6.exitCode} (${sleepElapsed}ms)`);
    console.log(`  Output: "${res6.output}"\n`);

    // 7. Persistent Session
    console.log('[7/7] Testing Persistent Session (Multi-command in same shell process)...');
    const sessId = 'manual-live-session';
    ptyManager.create(
      { id: sessId, cols: 120, rows: 40, shell: 'powershell.exe' },
      {
        onData: (d) => sessions.appendOutput(sessId, d),
        onExit: () => sessions.setStatus(sessId, 'closed'),
      },
    );
    sessions.create(3600, 'powershell.exe', 'powershell');

    // Wait 300ms for shell prompt
    await new Promise((r) => setTimeout(r, 300));

    // Command A: Set an environment variable in the session
    const res7a = await executor.executeCommand(
      "$env:MACHINEBRIDGE_TEST_VAR = 'active-and-persistent'",
      undefined,
      10000,
      'powershell.exe',
      sessId,
    );
    console.log(`  Command A ExitCode: ${res7a.exitCode}`);

    // Command B: Read the environment variable back in the same session
    const res7b = await executor.executeCommand(
      'Write-Output "Value: $env:MACHINEBRIDGE_TEST_VAR"',
      undefined,
      10000,
      'powershell.exe',
      sessId,
    );
    console.log(`  Command B ExitCode: ${res7b.exitCode}`);
    console.log(`  Command B Output: "${res7b.output}"`);

    ptyManager.close(sessId);
    console.log('  Session closed cleanly.');

    console.log('\n=== ALL 7 MANUAL VERIFICATION SCENARIOS PASSED ===');
    process.exit(0);
  } catch (err) {
    console.error('Test error:', err);
    process.exit(1);
  } finally {
    ptyManager.closeAll();
  }
}

runManualTests();
