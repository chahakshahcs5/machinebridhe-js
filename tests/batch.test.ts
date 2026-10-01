import {
  formatBatchMarkdown,
  formatBatchJson,
  type BatchExecuteResult,
} from '@machinebridge/shared';

describe('batch command execution', () => {
  const mockBatchResult: BatchExecuteResult = {
    ok: true,
    sessionId: 'test-session-123',
    summary: {
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
    },
    results: [
      {
        command: 'git status',
        exitCode: 0,
        status: 'success',
        output: 'On branch main\nnothing to commit',
        durationMs: 45,
      },
      {
        command: 'pnpm test',
        exitCode: 1,
        status: 'failed',
        output: 'FAIL tests/example.test.ts\n1 test failed',
        durationMs: 320,
      },
      {
        command: 'pnpm deploy',
        exitCode: -1,
        status: 'skipped',
        output: '',
        durationMs: 0,
      },
    ],
  };

  it('formats batch results into clean Markdown sections', () => {
    const md = formatBatchMarkdown(mockBatchResult);

    expect(md).toContain('### 📋 Batch Execution: 1/3 Succeeded (1 Failed), 1 Skipped');
    expect(md).toContain('#### [1/3] `git status` — ✓ Succeeded [45ms]');
    expect(md).toContain('```text\nOn branch main\nnothing to commit\n```');
    expect(md).toContain('#### [2/3] `pnpm test` — ✗ Failed (Exit Code: 1) [320ms]');
    expect(md).toContain('FAIL tests/example.test.ts');
    expect(md).toContain('#### [3/3] `pnpm deploy` — ⊘ Skipped');
    expect(md).toContain('*(Command skipped due to previous failure)*');
  });

  it('formats batch results into valid JSON', () => {
    const jsonStr = formatBatchJson(mockBatchResult);
    const parsed = JSON.parse(jsonStr) as BatchExecuteResult;

    expect(parsed).toBeDefined();
    expect(parsed.summary.total).toBe(3);
    expect(parsed.summary.passed).toBe(1);
    expect(parsed.summary.failed).toBe(1);
    expect(parsed.summary.skipped).toBe(1);
    expect(parsed.results).toHaveLength(3);
    expect(parsed.results[0].command).toBe('git status');
    expect(parsed.results[0].status).toBe('success');
  });
});
