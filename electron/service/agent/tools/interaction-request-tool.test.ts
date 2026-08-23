import { describe, expect, it, vi } from 'vitest';

import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { interactionRequestTool } from './interaction-request-tool';

function context(
  requestInteraction?: AgentToolExecutionContext['requestInteraction'],
): AgentToolExecutionContext {
  return {
    appContext: { libraryId: 3, platform: 'darwin' as const, selectedNodeIds: [] },
    onProgress: vi.fn(),
    requestInteraction,
    signal: new AbortController().signal,
  };
}

describe('interaction.request Tool', () => {
  const request = {
    kind: 'choice' as const,
    options: [{ id: 'keep', label: '保留' }, { id: 'replace', label: '覆盖' }],
    prompt: '请选择冲突处理方式',
  };

  it('uses an explicit write-risk policy instead of the generic read auto-execution path', async () => {
    expect(interactionRequestTool.risk).toBe('write');
    expect(await interactionRequestTool.assess?.(request, context()))
      .toEqual({ behavior: 'allow', risk: 'write' });
  });

  it('uses the controlled runtime interaction channel and returns the response as Tool data', async () => {
    const requestInteraction = vi.fn(async () => ({
      kind: 'choice' as const,
      selectedOptionIds: ['keep'],
    }));

    await expect(interactionRequestTool.execute?.(
      request,
      context(requestInteraction),
    )).resolves.toEqual({
      data: { response: { kind: 'choice', selectedOptionIds: ['keep'] } },
      message: '用户已提交选择',
      ok: true,
    });
    expect(requestInteraction).toHaveBeenCalledWith(request);
  });

  it('rejects malformed input before opening an interaction', async () => {
    expect(await interactionRequestTool.validate?.({
      kind: 'choice',
      options: [{ id: 'only', label: '唯一选项' }],
      prompt: '请选择',
    }, context())).toMatchObject({ ok: false });
  });

  it('rejects secret-related interaction fields before opening an interaction', async () => {
    expect(await interactionRequestTool.validate?.({
      fields: [{ id: 'access.token', label: '连接值', type: 'text' }],
      kind: 'form',
      prompt: '补充参数',
    }, context())).toMatchObject({
      message: expect.stringContaining('不能索取'),
      ok: false,
    });
  });

  it('fails closed when the runtime does not expose interaction requests', async () => {
    await expect(interactionRequestTool.execute?.(request, context())).resolves.toEqual({
      message: '当前 Agent 运行时不支持交互请求',
      ok: false,
    });
  });
});
