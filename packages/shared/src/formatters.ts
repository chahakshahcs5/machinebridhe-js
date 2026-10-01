export interface BatchCommandResult {
  command: string;
  exitCode: number;
  status: 'success' | 'failed' | 'skipped';
  output: string;
  durationMs?: number;
}

export interface BatchExecuteResult {
  ok?: boolean;
  sessionId?: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
  };
  results: BatchCommandResult[];
}

export interface FsBatchResultItem {
  index: number;
  type: string;
  path?: string;
  command?: string;
  success: boolean;
  error?: string;
  data?: unknown;
  durationMs?: number;
}

export interface FsBatchResult {
  ok?: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: FsBatchResultItem[];
}

export function formatBatchMarkdown(result: BatchExecuteResult): string {
  const { summary, results } = result;
  const header = `### 📋 Batch Execution: ${summary.passed}/${summary.total} Succeeded${summary.failed > 0 ? ` (${summary.failed} Failed)` : ''}${summary.skipped > 0 ? `, ${summary.skipped} Skipped` : ''}`;

  const sections = results.map((res, i) => {
    let badge = '✓ Succeeded';
    if (res.status === 'failed') {
      badge = `✗ Failed (Exit Code: ${res.exitCode})`;
    } else if (res.status === 'skipped') {
      badge = '⊘ Skipped';
    }

    const duration = typeof res.durationMs === 'number' ? ` [${res.durationMs}ms]` : '';
    const title = `#### [${i + 1}/${results.length}] \`${res.command}\` — ${badge}${duration}`;
    const outputBody =
      res.status === 'skipped'
        ? '*(Command skipped due to previous failure)*'
        : res.output
          ? `\`\`\`text\n${res.output}\n\`\`\``
          : '*(Command completed with no output)*';

    return `${title}\n${outputBody}`;
  });

  return `${header}\n\n${sections.join('\n\n')}`;
}

export function formatBatchJson(result: BatchExecuteResult): string {
  return JSON.stringify(result, null, 2);
}

export function formatFsBatchMarkdown(result: FsBatchResult): string {
  const { total, passed, failed, skipped } = result;
  const header = `### 📋 Batch Operations: ${passed}/${total} Succeeded${failed > 0 ? ` (${failed} Failed)` : ''}${skipped > 0 ? `, ${skipped} Skipped` : ''}`;

  const sections = result.results.map((res, i) => {
    const isSkipped = !res.success && res.error === 'Skipped due to previous operation failure';
    let badge = '✓ Succeeded';
    if (isSkipped) {
      badge = '⊘ Skipped';
    } else if (!res.success) {
      badge = `✗ Failed: ${res.error || 'Unknown error'}`;
    }

    const duration = typeof res.durationMs === 'number' ? ` [${res.durationMs}ms]` : '';
    const label =
      res.type === 'command'
        ? `Command \`${res.command || ''}\``
        : `${res.type.toUpperCase()} \`${res.path || ''}\``;
    const title = `#### [${i + 1}/${result.results.length}] ${label} — ${badge}${duration}`;

    let body = '';
    if (isSkipped) {
      body = '*(Operation skipped due to previous failure)*';
    } else if (!res.success) {
      body = `Error: ${res.error || 'Operation failed'}`;
    } else if (res.type === 'command') {
      const out = (res.data as { output?: string })?.output;
      body = out ? `\`\`\`text\n${out}\n\`\`\`` : '*(Command completed with no output)*';
    } else if (res.type === 'write') {
      const data = res.data as { bytesWritten?: number; sha256?: string } | undefined;
      body = `*Wrote ${data?.bytesWritten ?? 0} bytes (SHA-256: ${data?.sha256 ? data.sha256.slice(0, 12) + '...' : 'N/A'})*`;
    } else if (res.type === 'read') {
      const data = res.data as { content?: string; bytesRead?: number; size?: number } | undefined;
      body = data?.content
        ? `\`\`\`text\n${data.content}\n\`\`\``
        : `*(Read ${data?.bytesRead ?? 0} bytes)*`;
    } else if (res.type === 'list') {
      const data = res.data as
        { entries?: Array<{ name: string; isDirectory: boolean; size: number }> } | undefined;
      const count = data?.entries?.length ?? 0;
      body = `*Listed ${count} items*`;
    } else {
      body = '*(Completed successfully)*';
    }

    return `${title}\n${body}`;
  });

  return `${header}\n\n${sections.join('\n\n')}`;
}

export function formatFsBatchJson(result: FsBatchResult): string {
  return JSON.stringify(result, null, 2);
}
