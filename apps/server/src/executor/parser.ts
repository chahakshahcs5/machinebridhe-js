/* eslint-disable no-control-regex */
export function cleanTerminalOutput(raw: string): string {
  if (!raw) return '';
  return (
    raw
      // Strip ANSI escape sequences (CSI, OSC, DEC, etc.)
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
      .replace(/\x1b[()][AB012]/g, '')
      .replace(/\x1b[=>]/g, '')
      // Normalize newlines
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Remove control characters except newline and tab
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
  );
}
/* eslint-enable no-control-regex */

export class CommandOutputParser {
  private rawBuffer = '';
  private completed = false;
  private result?: { output: string; exitCode: number };

  constructor(
    public readonly markerId: string,
    public readonly shellType: 'powershell' | 'cmd' | 'sh' = 'powershell',
  ) {}

  public appendChunk(chunk: string): boolean {
    if (this.completed) return true;
    this.rawBuffer += chunk;

    // Fast check: the completion marker appears at the tail end of the output.
    // Check the last window (chunk size + safety margin) to avoid O(N^2) full-buffer scans on multi-MB outputs.
    const scanWindow = this.rawBuffer.slice(-Math.max(4096, chunk.length + 256));
    const strippedWindow = cleanTerminalOutput(scanWindow);
    const complRegex = new RegExp(`\\[__MB_COMPL_${this.markerId}_(-?\\d+)__\\]`);

    if (complRegex.test(strippedWindow)) {
      this.completed = true;
      const fullStripped = cleanTerminalOutput(this.rawBuffer);
      const fullMatch = complRegex.exec(fullStripped);

      if (fullMatch) {
        const exitCode = parseInt(fullMatch[1], 10);
        const startMarker = `[__MB_START_${this.markerId}__]`;
        const startMarkerRegex = new RegExp(
          `(?:\r?\n|^)\\[__MB_START_${this.markerId}__\\](?:\r?\n|$)`,
        );
        const startMatch = startMarkerRegex.exec(fullStripped);

        let commandOutput = '';
        if (startMatch && startMatch.index < fullMatch.index) {
          const startIndex = startMatch.index + startMatch[0].length;
          commandOutput = fullStripped.substring(startIndex, fullMatch.index);
        } else {
          const lastIdx = fullStripped.lastIndexOf(startMarker, fullMatch.index);
          if (lastIdx !== -1) {
            commandOutput = fullStripped.substring(lastIdx + startMarker.length, fullMatch.index);
          } else {
            commandOutput = fullStripped.substring(0, fullMatch.index);
          }
        }

        this.result = {
          output: cleanTerminalOutput(commandOutput),
          exitCode: isNaN(exitCode) ? 0 : exitCode,
        };
      } else {
        this.result = {
          output: cleanTerminalOutput(this.rawBuffer),
          exitCode: 0,
        };
      }
      return true;
    }

    return false;
  }

  public completeOnProcessExit(exitCode: number): { output: string; exitCode: number } {
    if (this.result) return this.result;
    this.completed = true;
    const fullStripped = cleanTerminalOutput(this.rawBuffer);
    const startMarker = `[__MB_START_${this.markerId}__]`;
    const startMarkerRegex = new RegExp(
      `(?:\r?\n|^)\\[__MB_START_${this.markerId}__\\](?:\r?\n|$)`,
    );
    const startMatch = startMarkerRegex.exec(fullStripped);

    let commandOutput = '';
    if (startMatch) {
      commandOutput = fullStripped.substring(startMatch.index + startMatch[0].length);
    } else {
      const lastIdx = fullStripped.lastIndexOf(startMarker);
      if (lastIdx !== -1) {
        commandOutput = fullStripped.substring(lastIdx + startMarker.length);
      } else {
        commandOutput = fullStripped;
      }
    }

    this.result = {
      output: cleanTerminalOutput(commandOutput),
      exitCode: typeof exitCode === 'number' ? exitCode : 0,
    };
    return this.result;
  }

  public isCompleted(): boolean {
    return this.completed;
  }

  public getResult(): { output: string; exitCode: number } | undefined {
    return this.result;
  }

  public getRawBuffer(): string {
    return this.rawBuffer;
  }
}
