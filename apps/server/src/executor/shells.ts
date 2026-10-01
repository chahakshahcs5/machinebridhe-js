export type ShellType = 'powershell' | 'cmd' | 'sh';

export function detectShellType(shellPath?: string): ShellType {
  if (!shellPath) {
    if (process.platform === 'win32') {
      const defaultShell = process.env.MACHINEBRIDGE_DEFAULT_SHELL || '';
      if (/cmd(\.exe)?$/i.test(defaultShell)) return 'cmd';
      return 'powershell';
    }
    return 'sh';
  }
  if (/(powershell|pwsh)(\.exe)?$/i.test(shellPath)) {
    return 'powershell';
  }
  if (/(cmd)(\.exe)?$/i.test(shellPath)) {
    return 'cmd';
  }
  return 'sh';
}

export function createCommandWithMarkers(
  command: string,
  markerId: string,
  shellType: ShellType,
): string {
  const trimmed = command.trim();

  if (shellType === 'powershell') {
    return (
      `[Console]::Out.WriteLine("[__MB_START_${markerId}__]"); ` +
      `try { & { ${trimmed} } } ` +
      `catch { Write-Error $_.ToString(); if (-not $LASTEXITCODE) { $LASTEXITCODE = 1 } } ` +
      `finally { ` +
      `$__mb_ec = if ($?) { if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 } } else { if ($LASTEXITCODE -ne $null -and $LASTEXITCODE -ne 0) { $LASTEXITCODE } else { 1 } }; ` +
      `[Console]::Out.WriteLine("[__MB_COMPL_${markerId}_" + $__mb_ec + "__]") ` +
      `}\r\n`
    );
  }

  if (shellType === 'cmd') {
    return `@echo [__MB_START_${markerId}__] & (${trimmed}) & @call echo [__MB_COMPL_${markerId}_%%ERRORLEVEL%%__]\r\n`;
  }

  // POSIX / sh / bash
  return `printf "[__MB_START_%s__]\\n" "${markerId}"; (${trimmed}); __mb_ec=$?; printf "[__MB_COMPL_%s_%d__]\\n" "${markerId}" "$__mb_ec"\n`;
}

export function getShellAndArgsForCommand(
  command: string,
  customShell?: string,
): { shell: string; args: string[] } {
  const isWindows = process.platform === 'win32';

  if (customShell) {
    if (/(powershell|pwsh)(\.exe)?$/i.test(customShell)) {
      return {
        shell: customShell,
        args: ['-NoProfile', '-NonInteractive', '-Command', command],
      };
    }
    if (/(cmd)(\.exe)?$/i.test(customShell)) {
      return {
        shell: customShell,
        args: ['/d', '/c', command],
      };
    }
    return {
      shell: customShell,
      args: ['-c', command],
    };
  }

  if (isWindows) {
    const defaultShell = process.env.MACHINEBRIDGE_DEFAULT_SHELL || 'powershell.exe';
    if (/(powershell|pwsh)(\.exe)?$/i.test(defaultShell)) {
      return {
        shell: defaultShell,
        args: ['-NoProfile', '-NonInteractive', '-Command', command],
      };
    }
    const cmdExe = process.env.COMSPEC || 'cmd.exe';
    return {
      shell: cmdExe,
      args: ['/d', '/c', command],
    };
  }

  const userShell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return {
    shell: userShell,
    args: ['-c', command],
  };
}
