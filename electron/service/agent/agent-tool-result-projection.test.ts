import { describe, expect, it } from 'vitest';

import { estimateAgentTextTokens } from './agent-context-projection';
import {
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT,
  MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS,
  projectAgentToolResultForProvider,
} from './agent-tool-result-projection';

describe('Agent Tool result provider projection', () => {
  it('keeps a complete structured result when it fits', () => {
    const projection = projectAgentToolResultForProvider({
      data: { entryCount: 1, entries: [{ id: 8, name: 'movie.mp4' }] },
      message: '目录读取完成',
      ok: true,
    }, 1_000);

    expect(projection.truncated).toBe(false);
    expect(JSON.parse(projection.content)).toEqual({
      data: { entryCount: 1, entries: [{ id: 8, name: 'movie.mp4' }] },
      message: '目录读取完成',
      ok: true,
    });
  });

  it('bounds nested data while preserving status and an explicit truncation marker', () => {
    const projection = projectAgentToolResultForProvider({
      data: {
        entries: Array.from({ length: 100 }, (_, index) => ({
          id: index + 1,
          name: `very-long-file-${index}-${'x'.repeat(500)}`,
        })),
        entryCount: 100,
      },
      message: '读取完成',
      ok: true,
    }, 300);
    const payload = JSON.parse(projection.content);

    expect(projection.truncated).toBe(true);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(300);
    expect(estimateAgentTextTokens(projection.content)).toBeLessThanOrEqual(300);
    expect(payload.ok).toBe(true);
    expect(payload._omniflowProjection).toMatchObject({
      reason: 'provider_context_budget',
      truncated: true,
      version: 1,
    });
  });

  it('redacts nested credentials and signed URLs only in the provider projection', () => {
    const result = {
      data: {
        apiKey: 'sk-provider-secret-value',
        nested: {
          authorization: 'Bearer abcdefghijklmnop',
          sourceUrl: 'https://storage.example/file.mp4?X-Amz-Credential=user&X-Amz-Signature=signed-secret',
        },
        safe: 'visible',
      },
      message: '读取完成',
      ok: true,
    };

    const projection = projectAgentToolResultForProvider(result, 1_000);

    expect(projection.truncated).toBe(false);
    expect(projection.content).toContain('[REDACTED]');
    expect(projection.content).toContain('[SIGNED_QUERY_REDACTED]');
    expect(projection.content).toContain('visible');
    expect(projection.content).not.toContain('sk-provider-secret-value');
    expect(projection.content).not.toContain('abcdefghijklmnop');
    expect(projection.content).not.toContain('signed-secret');
    expect(result.data.apiKey).toBe('sk-provider-secret-value');
    expect(result.data.nested.authorization).toBe('Bearer abcdefghijklmnop');
  });

  it('exports the conservative minimum legal Tool result projection', () => {
    expect(estimateAgentTextTokens(MINIMUM_AGENT_PROVIDER_TOOL_RESULT_CONTENT))
      .toBe(MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS);
    expect(() => projectAgentToolResultForProvider({
      data: { value: 'x'.repeat(10_000) },
      ok: true,
    }, MINIMUM_AGENT_PROVIDER_TOOL_RESULT_TOKENS)).not.toThrow();
  });

  it('fails explicitly when even the minimal structured marker cannot fit', () => {
    expect(() => projectAgentToolResultForProvider({ ok: true }, 2))
      .toThrow('没有足够的模型上下文预算');
  });

  it('keeps an ordinary Markdown document complete for Shell within a 10k token budget', () => {
    const document = Array.from(
      { length: 287 },
      (_, index) => `## ${index + 1}\n${'x'.repeat(92)}\n`,
    ).join('');
    const projection = projectAgentToolResultForProvider({
      data: {
        droppedOutputBytes: 1_234,
        executionId: 'execution-secret',
        logRef: `log:v1:${'e'.repeat(64)}`,
        previewTruncated: true,
        providerOutput: {
          stderr: {
            head: '',
            omittedBytes: 0,
            tail: '',
            totalBytes: 0,
            truncated: false,
          },
          stdout: {
            head: document,
            omittedBytes: 0,
            tail: '',
            totalBytes: Buffer.byteLength(document, 'utf8'),
            truncated: false,
          },
          version: 1,
        },
        status: 'completed',
        stderrTail: 'renderer stderr',
        stdoutTail: 'renderer stdout',
        tailTruncated: true,
      },
      message: 'Shell 命令执行完成',
      ok: true,
    }, 10_000, { mode: 'shell' });
    const payload = JSON.parse(projection.content);

    expect(Buffer.byteLength(document, 'utf8')).toBeGreaterThan(27 * 1_024);
    expect(projection.truncated).toBe(false);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(10_000);
    expect(payload.data.output.stdout).toEqual({
      content: document,
      omittedBytes: 0,
      totalBytes: Buffer.byteLength(document, 'utf8'),
      truncated: false,
    });
    expect(payload.data.output.stdout).not.toHaveProperty('head');
    expect(payload.data.output.stdout).not.toHaveProperty('tail');
    expect(payload.data).not.toHaveProperty('executionId');
    expect(payload.data).not.toHaveProperty('logRef');
    expect(payload.data).not.toHaveProperty('providerOutput');
    expect(payload.data).not.toHaveProperty('stderrTail');
    expect(payload.data).not.toHaveProperty('stdoutTail');
    expect(payload.data).not.toHaveProperty('tailTruncated');
    expect(payload.data).not.toHaveProperty('previewTruncated');
    expect(payload.data).not.toHaveProperty('droppedOutputBytes');
  });

  it('retains both ends of oversized Shell text when provider context is tighter', () => {
    const output = `document-start\n${'x'.repeat(80_000)}\ndocument-end`;
    const projection = projectAgentToolResultForProvider({
      data: {
        providerOutput: {
          stderr: {
            head: '',
            omittedBytes: 0,
            tail: '',
            totalBytes: 0,
            truncated: false,
          },
          stdout: {
            head: output,
            omittedBytes: 0,
            tail: '',
            totalBytes: Buffer.byteLength(output, 'utf8'),
            truncated: false,
          },
          version: 1,
        },
        status: 'completed',
      },
      ok: true,
    }, 2_000, { mode: 'shell' });
    const payload = JSON.parse(projection.content);
    const projectedOutput = payload.data.output.stdout;
    const retainedBytes = Buffer.byteLength(projectedOutput.head, 'utf8')
      + Buffer.byteLength(projectedOutput.tail, 'utf8');

    expect(projection.truncated).toBe(true);
    expect(projection.estimatedTokens).toBeLessThanOrEqual(2_000);
    expect(projectedOutput.head).toMatch(/^document-start/u);
    expect(projectedOutput.tail).toMatch(/document-end$/u);
    expect(projectedOutput.truncated).toBe(true);
    expect(projectedOutput.omittedBytes).toBe(projectedOutput.totalBytes - retainedBytes);
    expect(payload._omniflowProjection).toMatchObject({
      reason: 'provider_context_budget',
      truncated: true,
      version: 1,
    });
  });

  it('recomputes Shell omitted bytes after a previously truncated source is projected again', () => {
    const source = {
      stderr: {
        head: '',
        omittedBytes: 0,
        tail: '',
        totalBytes: 0,
        truncated: false,
      },
      stdout: {
        head: `document-start\n${'h'.repeat(45_000)}`,
        omittedBytes: 89_972,
        tail: `${'t'.repeat(45_000)}\ndocument-end`,
        totalBytes: 180_000,
        truncated: true,
      },
      version: 1,
    } as const;
    const projection = projectAgentToolResultForProvider({
      data: { providerOutput: source, status: 'completed' },
      ok: true,
    }, 2_000, { mode: 'shell' });
    const output = JSON.parse(projection.content).data.output.stdout;
    const retainedBytes = Buffer.byteLength(output.head, 'utf8')
      + Buffer.byteLength(output.tail, 'utf8');

    expect(projection.truncated).toBe(true);
    expect(output.head).toMatch(/^document-start/u);
    expect(output.tail).toMatch(/document-end$/u);
    expect(output.omittedBytes).toBe(output.totalBytes - retainedBytes);
    expect(output.omittedBytes).toBeGreaterThan(source.stdout.omittedBytes);
  });

  it('preserves both Shell streams under one tight provider budget', () => {
    const projection = projectAgentToolResultForProvider({
      data: {
        providerOutput: {
          stderr: {
            head: `stderr-start\n${'e'.repeat(30_000)}\nstderr-end`,
            omittedBytes: 0,
            tail: '',
            totalBytes: 30_024,
            truncated: false,
          },
          stdout: {
            head: `stdout-start\n${'o'.repeat(30_000)}\nstdout-end`,
            omittedBytes: 0,
            tail: '',
            totalBytes: 30_024,
            truncated: false,
          },
          version: 1,
        },
        status: 'completed',
      },
      ok: true,
    }, 1_500, { mode: 'shell' });
    const output = JSON.parse(projection.content).data.output;

    for (const stream of [output.stdout, output.stderr]) {
      const retainedBytes = Buffer.byteLength(stream.head, 'utf8')
        + Buffer.byteLength(stream.tail, 'utf8');
      expect(retainedBytes).toBeGreaterThan(0);
      expect(stream.truncated).toBe(true);
      expect(stream.omittedBytes).toBe(stream.totalBytes - retainedBytes);
    }
    expect(output.stdout.head).toMatch(/^stdout-start/u);
    expect(output.stdout.tail).toMatch(/stdout-end$/u);
    expect(output.stderr.head).toMatch(/^stderr-start/u);
    expect(output.stderr.tail).toMatch(/stderr-end$/u);
  });
});
