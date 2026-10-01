import { PtyManager } from '../packages/pty/dist/index.js';
import { cleanTerminalOutput } from '../apps/server/dist/executor/parser.js';

async function testStrategy(name, createCommand) {
  console.log(`\n================== STRATEGY: ${name} ==================`);
  const pty = new PtyManager();
  const session = pty.create({
    id: 'strat-test',
    cols: 120,
    rows: 40,
    shell: 'powershell.exe',
  }, { onData: () => {}, onExit: () => {} });

  await new Promise(r => setTimeout(r, 600));

  const commands = [
    'echo "hello"',
    'throw "fatal error"',
    'Get-Item NonExistentFile12345',
    'cmd.exe /c exit 1',
    'echo "after failure"',
    'nonexistentcmd12345',
  ];

  for (const cmd of commands) {
    console.log(`\n--- Testing command: ${cmd} ---`);
    let rawOutput = '';
    const removeData = session.onData(data => { rawOutput += data; });

    const invocation = createCommand(cmd, 'TESTMARKER');
    session.write(invocation);

    // wait for output to settle
    await new Promise(r => setTimeout(r, 1200));
    removeData();

    const cleaned = cleanTerminalOutput(rawOutput);
    console.log('Cleaned output:');
    console.log(cleaned);
  }

  pty.closeAll();
}

async function run() {
  // Strategy 2: Multi-line with [Console]::Error and reset exit code
  await testStrategy('Multi-line with [Console]::Error', (cmd, marker) => {
    return (
      `$global:LASTEXITCODE = 0\r\n` +
      `[Console]::Out.WriteLine("[__MB_START_${marker}__]")\r\n` +
      `try {\r\n` +
      `  & { ${cmd} }\r\n` +
      `} catch {\r\n` +
      `  [Console]::Error.WriteLine($_.Exception.Message)\r\n` +
      `  if (-not $global:LASTEXITCODE) { $global:LASTEXITCODE = 1 }\r\n` +
      `} finally {\r\n` +
      `  $__mb_ec = if ($?) { if ($global:LASTEXITCODE -ne $null) { $global:LASTEXITCODE } else { 0 } } else { if ($global:LASTEXITCODE -ne $null -and $global:LASTEXITCODE -ne 0) { $global:LASTEXITCODE } else { 1 } }\r\n` +
      `  [Console]::Out.WriteLine("[__MB_COMPL_${marker}_" + $__mb_ec + "__]")\r\n` +
      `}\r\n`
    );
  });

  process.exit(0);
}

run().catch(console.error);
