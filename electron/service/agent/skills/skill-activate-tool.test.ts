import { describe, expect, it, vi } from 'vitest';

import type { AgentToolExecutionContext } from '../agent-tool-registry';
import {
  createAgentSkillRegistry,
} from './agent-skill-registry';
import { mediaExtractAudioSkill } from './agent-skill-catalog';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  skillActivateTool,
} from './skill-activate-tool';

function context(
  skillSnapshot?: ReturnType<typeof createAgentSkillRegistry> extends infer Registry
    ? Registry extends { createRunSnapshot: (...args: never[]) => infer Snapshot }
      ? Snapshot
      : never
    : never,
): AgentToolExecutionContext & { skillSnapshot?: typeof skillSnapshot } {
  return {
    appContext: { platform: 'darwin' as const, selectedNodeIds: [] },
    onProgress: vi.fn(),
    ...(skillSnapshot ? { skillSnapshot } : {}),
    signal: new AbortController().signal,
  };
}

function snapshot() {
  const registry = createAgentSkillRegistry({
    estimateTokens: text => Math.ceil([...text].length / 2),
    maxSummaryTokens: 256,
    maxActivationTokens: 1_024,
    toolExists: () => true,
  });
  registry.register(mediaExtractAudioSkill);
  return registry.createRunSnapshot();
}

describe(`${AGENT_SKILL_ACTIVATE_TOOL_NAME} Tool`, () => {
  it('is a read-only control Tool with a closed input schema', () => {
    expect(skillActivateTool.kind).toBe('control');
    expect(skillActivateTool.executor).toBe('main');
    expect(skillActivateTool.risk).toBe('read');
    expect(skillActivateTool.inputSchema).toMatchObject({
      additionalProperties: false,
      required: ['skillId'],
    });
    expect(skillActivateTool.assess?.({}, context())).toEqual({
      behavior: 'allow',
      risk: 'read',
    });
  });

  it('loads the complete envelope only from the current Run snapshot', async () => {
    const runSnapshot = snapshot();
    await expect(skillActivateTool.execute?.(
      { skillId: ' media-extract-audio ' },
      context(runSnapshot),
    )).resolves.toMatchObject({
      data: {
        instructions: mediaExtractAudioSkill.instructions,
        skillId: mediaExtractAudioSkill.id,
        toolAllowlist: mediaExtractAudioSkill.toolAllowlist,
        version: mediaExtractAudioSkill.version,
      },
      ok: true,
    });
  });

  it('fails closed without a snapshot or for an unknown/hidden Skill', async () => {
    await expect(skillActivateTool.execute?.(
      { skillId: mediaExtractAudioSkill.id },
      context(),
    )).resolves.toEqual({
      message: '当前 Agent 运行未提供 Skill 快照',
      ok: false,
    });
    const empty = createAgentSkillRegistry({
      estimateTokens: text => Math.ceil([...text].length / 2),
      maxSummaryTokens: 256,
      maxActivationTokens: 1_024,
    }).createRunSnapshot();
    await expect(skillActivateTool.execute?.(
      { skillId: 'media-extract-audio' },
      context(empty),
    )).resolves.toMatchObject({ ok: false, message: expect.stringContaining('不可激活') });
  });

  it('rejects malformed IDs before touching the snapshot', async () => {
    const runSnapshot = snapshot();
    expect(skillActivateTool.validate?.({ skillId: '../secret' }, context(runSnapshot)))
      .toMatchObject({ ok: false });
    await expect(skillActivateTool.execute?.(
      { skillId: '../secret' },
      context(runSnapshot),
    )).resolves.toEqual({ message: 'Skill ID 无效', ok: false });
  });
});

