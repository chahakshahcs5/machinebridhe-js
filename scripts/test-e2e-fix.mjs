import { PtyManager } from '../packages/pty/dist/index.js';
import { InMemorySessionStore } from '../apps/server/dist/sessions.js';

/* eslint-disable no-control-regex */
function enhancedCleanTerminalOutput(raw) {
  if (!raw) return '';
  let text = raw
    .replace(/\x1b\[[0-9:;<=>?]*[ !"#$%&'()*+,-./]*[@A-Z\[\\\]^_`a-z{|}~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '')
    .replace(/\x1b[P^_][^\x1b]*(?:\x1b\\|$)/g, '')
    .replace(/\x1b[()#%*+-./][A-Za-z0-9]/g, '')
    .replace(/\x1b[<=>78DEMNPQc]/g, '')
    .replace(/\r\n/g, '\n');

  if (text.includes('\r')) {
    text = text
      .split('\n')
      .map((line) => {
        if (!line.includes('\r')) return line;
        const parts = line.split('\r');
        return parts.filter(Boolean).pop() || '';
      })
      .join('\n');
  }

  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  return text.trim();
}

function stripInternalWrapperArtifacts(output, markerId) {
  if (!output) return '';
  const lines = output.split('\n');
  const filtered = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (
      line.includes('__MB_START_') ||
      line.includes('__MB_COMPL_') ||
      line.includes('$__mb_') ||
      line.includes('$global:LASTEXITCODE') ||
      line.includes('[Console]::Out.WriteLine') ||
      line.includes('[Console]::Error.WriteLine') ||
      (markerId && line.includes(markerId))
    ) {
      if (i + 1 < lines.length && /^\+\s*~+/.test(lines[i + 1])) {
        i++;
      }
      if (filtered.length > 0 && /^At line:\d+\s+char:\d+/i.test(filtered[filtered.length - 1])) {
        filtered.pop();
      }
      continue;
    }
    if (/^\+\s*\.\.\..*try\s*\{\s*&/i.test(line) || /^\s*try\s*\{\s*&\s*\{/i.test(line)) {
      if (i + 1 < lines.length && /^\+\s*~+/.test(lines[i + 1])) {
        i++;
      }
      if (filtered.length > 0 && /^At line:\d+\s+char:\d+/i.test(filtered[filtered.length - 1])) {
        filtered.pop();
      }
      continue;
    }
    filtered.push(line);
  }

  return filtered.join('\n').trim();
}

function createCommandWithMarkers(command, markerId) {
  const trimmed = command.trim();
  return (
    `$global:LASTEXITCODE = $null; ` +
    `$__mb_ec0 = $Error.Count; ` +
    `[Console]::Out.WriteLine([char]91 + "__MB_START_${markerId}__" + [char]93); ` +
    `try { & { ${trimmed} } } ` +
    `catch { [Console]::Error.WriteLine($_.Exception.Message) } ` +
    `finally { ` +
    `$__mb_has_err = ($Error.Count -gt $__mb_ec0); ` +
    `$__mb_ec = if ($global:LASTEXITCODE -ne $null -and $global:LASTEXITCODE -ne 0) { $global:LASTEXITCODE } ` +
    `elseif ($__mb_has_err) { 1 } else { 0 }; ` +
    `[Console]::Out.WriteLine([char]91 + "__MB_COMPL_${markerId}_" + $__mb_ec + "__" + [char]93) ` +
    `}\r\n`
  );
}

class TestParser {
  constructor(markerId) {
    this.markerId = markerId;
    this.rawBuffer = '';
    this.completed = false;
    this.result = undefined;
  }

  appendChunk(chunk) {
    if (this.completed) return true;
    this.rawBuffer += chunk;
    const strippedWindow = enhancedCleanTerminalOutput(this.rawBuffer.slice(-4096));
    const complRegex = new RegExp(`\\[__MB_COMPL_${this.markerId}_(-?\\d+)__\\]`);

    if (complRegex.test(strippedWindow)) {
      this.completed = true;
      const fullStripped = enhancedCleanTerminalOutput(this.rawBuffer);
      const fullMatch = complRegex.exec(fullStripped);

      if (fullMatch) {
        const exitCode = parseInt(fullMatch[1], 10);
        const startMarker = `[__MB_START_${this.markerId}__]`;
        const lastIdx = fullStripped.lastIndexOf(startMarker, fullMatch.index);
        let commandOutput = '';
        if (lastIdx !== -1) {
          commandOutput = fullStripped.substring(lastIdx + startMarker.length, fullMatch.index);
        } else {
          commandOutput = fullStripped.substring(0, fullMatch.index);
        }

        this.result = {
          output: stripInternalWrapperArtifacts(enhancedCleanTerminalOutput(commandOutput), this.markerId),
          exitCode: isNaN(exitCode) ? 0 : exitCode,
        };
      } else {
        this.result = {
          output: stripInternalWrapperArtifacts(enhancedCleanTerminalOutput(this.rawBuffer), this.markerId),
          exitCode: 0,
        };
      }
      return true;
    }
    return false;
  }
}

async function runAll() {
  const pty = new PtyManager();
  const session = pty.create({
    id: 'e2e-test',
    cols: 120,
    rows: 40,
    shell: 'powershell.exe',
  }, { onData: () => {}, onExit: () => {} });

  await new Promise(r => setTimeout(r, 600));

  const testCommands = [
    'echo "Hello from batch 1"',
    'Get-Date -Format yyyy',
    'throw "Intentional terminating error"',
    'Get-Item NonExistentPath_Test',
    'cmd.exe /c exit 5',
    'echo "Recovered after exit 5"',
  ];

  console.log('--- Testing execute_commands pipeline ---');
  for (let i = 0; i < testCommands.length; i++) {
    const cmd = testCommands[i];
    const marker = 'M' + i + 'x' + Date.now();
    const parser = new TestParser(marker);

    const removeData = session.onData(data => {
      parser.appendChunk(data);
    });

    session.write(createCommandWithMarkers(cmd, marker));

    const start = Date.now();
    while (!parser.completed && Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 50));
    }
    removeData();

    const res = parser.result;
    console.log(`Command [${i + 1}]: "${cmd}"`);
    console.log(`Exit code: ${res?.exitCode}`);
    console.log(`Output:\n"${res?.output}"`);
    console.log('-------------------------------------------');
  }

  pty.closeAll();
  process.exit(0);
}

runAll().catch(console.error);
