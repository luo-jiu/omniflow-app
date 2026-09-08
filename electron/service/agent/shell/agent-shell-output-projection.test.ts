import { describe, expect, it } from 'vitest';

import type {
  AgentShellOutputFrameV1,
} from '../../../../src/shared/agent/shell/agent-shell.types';
import {
  AGENT_SHELL_PROVIDER_OUTPUT_MAX_BYTES,
  createAgentShellOutputProjectionCollector,
  projectAgentShellProviderOutput,
} from './agent-shell-output-projection';

function frame(
  sequence: number,
  stream: AgentShellOutputFrameV1['stream'],
  text: string,
): AgentShellOutputFrameV1 {
  return {
    executionId: 'execution-1',
    observedAt: new Date(sequence).toISOString(),
    sequence,
    stream,
    text,
  };
}

describe('Agent Shell provider output projection', () => {
  it('keeps a document larger than the old 32 KiB source complete for model projection', () => {
    const collector = createAgentShellOutputProjectionCollector();
    const document = Array.from(
      { length: 720 },
      (_, index) => `${String(index + 1).padStart(3, '0')} ${'x'.repeat(80)}\n`,
    ).join('');

    collector.append([frame(1, 'stdout', document)]);
    const projection = collector.snapshot();

    expect(Buffer.byteLength(document, 'utf8')).toBeGreaterThan(32 * 1024);
    expect(Buffer.byteLength(document, 'utf8'))
      .toBeLessThan(AGENT_SHELL_PROVIDER_OUTPUT_MAX_BYTES);
    expect(projection.stdout).toEqual({
      head: document,
      omittedBytes: 0,
      tail: '',
      totalBytes: Buffer.byteLength(document, 'utf8'),
      truncated: false,
    });
    expect(projection.stderr.totalBytes).toBe(0);
  });

  it('retains true UTF-8 head and tail with explicit omitted byte metadata', () => {
    const collector = createAgentShellOutputProjectionCollector(60);
    const output = `开头-${'中'.repeat(80)}-结尾`;

    collector.append([frame(1, 'stdout', output)]);
    const projection = collector.snapshot().stdout;

    expect(projection.truncated).toBe(true);
    expect(projection.head).toMatch(/^开头-/u);
    expect(projection.tail).toMatch(/-结尾$/u);
    expect(projection.head).not.toContain('\uFFFD');
    expect(projection.tail).not.toContain('\uFFFD');
    expect(projection.omittedBytes).toBe(
      projection.totalBytes
      - Buffer.byteLength(projection.head, 'utf8')
      - Buffer.byteLength(projection.tail, 'utf8'),
    );
  });

  it('shares one aggregate budget while preserving both output streams', () => {
    const collector = createAgentShellOutputProjectionCollector(4_096);
    collector.append([
      frame(1, 'stdout', `stdout-head-${'a'.repeat(8_000)}-stdout-tail`),
      frame(2, 'stderr', `stderr-head-${'b'.repeat(8_000)}-stderr-tail`),
    ]);

    const projection = collector.snapshot();
    const retainedBytes = Buffer.byteLength(projection.stdout.head, 'utf8')
      + Buffer.byteLength(projection.stdout.tail, 'utf8')
      + Buffer.byteLength(projection.stderr.head, 'utf8')
      + Buffer.byteLength(projection.stderr.tail, 'utf8');

    expect(retainedBytes).toBeLessThanOrEqual(4_096);
    expect(projection.stdout.head).toMatch(/^stdout-head-/u);
    expect(projection.stdout.tail).toMatch(/-stdout-tail$/u);
    expect(projection.stderr.head).toMatch(/^stderr-head-/u);
    expect(projection.stderr.tail).toMatch(/-stderr-tail$/u);
  });

  it('can reproject a retained source to a smaller aggregate UTF-8 budget', () => {
    const collector = createAgentShellOutputProjectionCollector(4_096);
    collector.append([
      frame(1, 'stdout', `标准输出-${'中'.repeat(2_000)}-结束`),
      frame(2, 'stderr', `错误输出-${'错'.repeat(2_000)}-结束`),
    ]);

    const projection = projectAgentShellProviderOutput(collector.snapshot(), 600);
    const retainedBytes = Buffer.byteLength(projection.stdout.head, 'utf8')
      + Buffer.byteLength(projection.stdout.tail, 'utf8')
      + Buffer.byteLength(projection.stderr.head, 'utf8')
      + Buffer.byteLength(projection.stderr.tail, 'utf8');

    expect(retainedBytes).toBeLessThanOrEqual(600);
    expect(projection.stdout.head).toMatch(/^标准输出-/u);
    expect(projection.stdout.tail).toMatch(/-结束$/u);
    expect(projection.stderr.head).toMatch(/^错误输出-/u);
    expect(projection.stderr.tail).toMatch(/-结束$/u);
    expect(projection.stdout.head + projection.stdout.tail).not.toContain('\uFFFD');
    expect(projection.stderr.head + projection.stderr.tail).not.toContain('\uFFFD');
  });

  it('keeps UTF-8 head and tail stable after many fragmented appends', () => {
    const collector = createAgentShellOutputProjectionCollector(64);
    const output = `开${'x'.repeat(20_000)}结`;
    let sequence = 1;

    for (const character of output) {
      collector.append([frame(sequence, 'stdout', character)]);
      sequence += 1;
    }

    const projection = collector.snapshot().stdout;
    const retainedBytes = Buffer.byteLength(projection.head, 'utf8')
      + Buffer.byteLength(projection.tail, 'utf8');
    expect(retainedBytes).toBeLessThanOrEqual(64);
    expect(projection.head).toMatch(/^开/u);
    expect(projection.tail).toMatch(/结$/u);
    expect(projection.head).not.toContain('\uFFFD');
    expect(projection.tail).not.toContain('\uFFFD');
    expect(projection.omittedBytes).toBe(
      projection.totalBytes - retainedBytes,
    );
  });
});
