/* eslint-disable no-control-regex */
function enhancedCleanTerminalOutput(raw) {
  if (!raw) return '';
  let text = raw
    // 1. ECMA-48 CSI sequences (Control Sequence Introducer)
    .replace(/\x1b\[[0-9:;<=>?]*[ !"#$%&'()*+,-./]*[@A-Z\[\\\]^_`a-z{|}~]/g, '')
    // 2. OSC sequences (Operating System Command)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\|$)/g, '')
    // 3. DCS, PM, APC sequences
    .replace(/\x1b[P^_][^\x1b]*(?:\x1b\\|$)/g, '')
    // 4. Two-character escape sequences (charset selection, etc.)
    .replace(/\x1b[()#%*+-./][A-Za-z0-9]/g, '')
    // 5. Single escape character controls
    .replace(/\x1b[<=>78DEMNPQc]/g, '')
    // 6. Normalize newlines
    .replace(/\r\n/g, '\n');

  // 7. Process carriage returns within lines (simulating terminal line rewrite)
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

  // 8. Remove non-printable control characters except newline (\n) and tab (\t)
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return text.trim();
}

console.log('Testing enhancedCleanTerminalOutput:');
const sample = "\u001b[0m\u001b[0KWindows PowerShell\u001b[0K\u001b[?25l\r\nCopyright (C) Microsoft Corporation. All rights reserved.\u001b[0K\r\n\u001b[0K\r\n\u001b[0K\u001b[?25hPS C:\\Users\\developer\\Projects\\machinebridge>\u001b[0K\u001b[43G\u001b[?25l\rPS C:\\Users\\developer\\Projects\\machinebridge> \u001b[0;33;93mG\u001b[0m\u001b[0K\u001b[?25h\u001b[0;33;93met-Date\u001b[0m\u001b[0K\u001b[?25l\r\n\u001b[0K\u001b[?25h\u001b[?25l\r\n07 September 2026 22:00:26";
console.log(enhancedCleanTerminalOutput(sample));
