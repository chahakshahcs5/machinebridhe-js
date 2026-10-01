import { PtyManager } from '../packages/pty/dist/index.js';
import { cleanTerminalOutput } from '../apps/server/dist/executor/parser.js';

async function testPwsh(label, buildCmd) {
  console.log(`\n=== TEST: ${label} ===`);
  const pty = new PtyManager();
  const session = pty.create({
    id: 'err-test',
    cols: 120,
    rows: 40,
    shell: 'powershell.exe',
  }, { onData: () => {}, onExit: () => {} });

  await new Promise(r => setTimeout(r, 600));

  const testCases = [
    'echo "success test"',
    'throw "my custom error message"',
    'Get-Item NonExistentPath_xyz',
    'cmd.exe /c exit 42',
    'echo "after exit 42"',
    'nonexistentcmd999',
  ];

  for (const cmd of testCases) {
    console.log(`\n--- CMD: ${cmd} ---`);
    let raw = '';
    const removeData = session.onData(d => { raw += d; });
    const inv = buildCmd(cmd, 'M123');
    session.write(inv);
    await new Promise(r => setTimeout(r, 1200));
    removeData();

    const cleaned = cleanTerminalOutput(raw);
    // Find output between start and compl markers
    const startIdx = cleaned.indexOf('[__MB_START_M123__]');
    const complMatch = /\[__MB_COMPL_M123_(-?\d+)__\]/.exec(cleaned);
    if (startIdx !== -1 && complMatch) {
      const output = cleaned.substring(startIdx + '[__MB_START_M123__]'.length, complMatch.index).trim();
      const exitCode = complMatch[1];
      console.log(`  ExitCode: ${exitCode}`);
      console.log(`  Extracted Output:\n"${output}"`);
      if (output.includes('__MB_') || output.includes('Console') || output.includes('try {') || output.includes('$__mb')) {
        console.log('  >>> LEAK PRESENT! <<<');
      } else {
        console.log('  >>> CLEAN! <<<');
      }
    } else {
      console.log('  Markers not found!');
      console.log('  Raw Cleaned:\n', cleaned);
    }
  }

  pty.closeAll();
}

async function main() {
  // Test Strategy A: Single-line with concatenated marker strings, resetting $LASTEXITCODE,
  // recording $?, and writing clean error on catch without Write-Error
  await testPwsh('Strategy A', (cmd, marker) => {
    // Note: avoid literal markers in the string so echo cannot contain them
    const trimmed = cmd.trim();
    return (
      `$global:LASTEXITCODE = $null; ` +
      `[Console]::Out.WriteLine([char]91 + "__MB_START_${marker}__" + [char]93); ` +
      `$__mb_ok = $true; ` +
      `try { & { ${trimmed} }; if (-not $?) { $__mb_ok = $false } } ` +
      `catch { $__mb_ok = $false; [Console]::Error.WriteLine($_.Exception.Message) } ` +
      `finally { ` +
      `$__mb_ec = if ($__mb_ok -and ($global:LASTEXITCODE -eq $null -or $global:LASTEXITCODE -eq 0)) { 0 } ` +
      `else { if ($global:LASTEXITCODE -ne $null -and $global:LASTEXITCODE -ne 0) { $global:LASTEXITCODE } else { 1 } }; ` +
      `[Console]::Out.WriteLine([char]91 + "__MB_COMPL_${marker}_" + $__mb_ec + [char]93) ` +
      `}\r\n`
    );
  });

  process.exit(0);
}

main().catch(console.error);
