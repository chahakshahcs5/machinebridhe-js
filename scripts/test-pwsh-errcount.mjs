import { PtyManager } from '../packages/pty/dist/index.js';
import { cleanTerminalOutput } from '../apps/server/dist/executor/parser.js';

async function test() {
  const pty = new PtyManager();
  const session = pty.create({
    id: 'err-test3',
    cols: 120,
    rows: 40,
    shell: 'powershell.exe',
  }, { onData: () => {}, onExit: () => {} });

  await new Promise(r => setTimeout(r, 600));

  const marker = 'TEST888';
  // Try with Invoke-Command or [scriptblock]::Create
  const cmd = 'Get-Item NonExistentPath_xyz';
  
  const inv = (
    `$global:LASTEXITCODE = $null; ` +
    `$__mb_ec0 = $Error.Count; ` +
    `[Console]::Out.WriteLine([char]91 + "__MB_START_${marker}__" + [char]93); ` +
    `try { . ([scriptblock]::Create(@'\n${cmd}\n'@)) } ` +
    `catch { [Console]::Error.WriteLine($_.Exception.Message) } ` +
    `finally { ` +
    `$__mb_has_err = ($Error.Count -gt $__mb_ec0); ` +
    `$__mb_ec = if ($global:LASTEXITCODE -ne $null -and $global:LASTEXITCODE -ne 0) { $global:LASTEXITCODE } ` +
    `elseif ($__mb_has_err) { 1 } else { 0 }; ` +
    `[Console]::Out.WriteLine([char]91 + "__MB_COMPL_${marker}_" + $__mb_ec + "__" + [char]93) ` +
    `}\r\n`
  );

  let raw = '';
  session.onData(d => { raw += d; });
  session.write(inv);
  await new Promise(r => setTimeout(r, 1200));

  const cleaned = cleanTerminalOutput(raw);
  const startIdx = cleaned.indexOf(`[__MB_START_${marker}__]`);
  const complMatch = new RegExp(`\\[__MB_COMPL_${marker}_(-?\\d+)__\\]`).exec(cleaned);

  if (startIdx !== -1 && complMatch) {
    const output = cleaned.substring(startIdx + `[__MB_START_${marker}__]`.length, complMatch.index).trim();
    console.log('Exit code:', complMatch[1]);
    console.log('Output:\n' + output);
  }

  pty.closeAll();
  process.exit(0);
}

test().catch(console.error);
