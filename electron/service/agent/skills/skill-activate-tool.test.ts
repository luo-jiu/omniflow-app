import { describe, expect, it, vi } from 'vitest';

import type { AgentToolExecutionContext } from '../agent-tool-registry';
import { createAgentToolRegistry } from '../agent-tool-registry';
import {
  createAgentRunCapabilitySnapshot,
  type AgentRunCapabilitySnapshot,
} from '../agent-run-capability-snapshot';
import { projectAgentToolResultForProvider } from '../agent-tool-result-projection';
import {
  createAgentSkillRegistry,
} from './agent-skill-registry';
import { mediaExtractAudioSkill } from './agent-skill-catalog';
import {
  AGENT_SKILL_ACTIVATE_TOOL_NAME,
  resolveAgentSkillActivationResult,
  skillActivateTool,
} from './skill-activate-tool';

function context(
  runCapabilitySnapshot?: AgentRunCapabilitySnapshot,
): AgentToolExecutionContext {
  return {
    appContext: { platform: 'darwin' as const, selectedNodeIds: [] },
    onProgress: vi.fn(),
    ...(runCapabilitySnapshot ? { runCapabilitySnapshot } : {}),
    signal: new AbortController().signal,
  };
}

function snapshot() {
  const toolRegistry = createAgentToolRegistry([
    skillActivateTool,
    ...mediaExtractAudioSkill.toolAllowlist.map(name => ({
      description: `Test Tool ${name}`,
      execute: async () => ({ ok: true }),
      inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
      name,
      risk: 'read' as const,
    })),
  ]);
  const registry = createAgentSkillRegistry({
    estimateTokens: text => Math.ceil([...text].length / 2),
    maxSummaryTokens: 256,
    maxActivationTokens: 1_024,
    toolExists: toolName => Boolean(toolRegistry.get(toolName)),
  });
  registry.register(mediaExtractAudioSkill);
  return createAgentRunCapabilitySnapshot({
    skillSnapshot: registry.createRunSnapshot(),
    toolSnapshot: toolRegistry.createSnapshot(),
  });
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
      { skillId: 'media-extract-audio' },
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
    const emptySkills = createAgentSkillRegistry({
      estimateTokens: text => Math.ceil([...text].length / 2),
      maxSummaryTokens: 256,
      maxActivationTokens: 1_024,
    }).createRunSnapshot();
    const empty = createAgentRunCapabilitySnapshot({
      skillSnapshot: emptySkills,
      toolSnapshot: createAgentToolRegistry([skillActivateTool]).createSnapshot(),
    });
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
    expect(skillActivateTool.validate?.(
      { skillId: ' media-extract-audio ' },
      context(runSnapshot),
    )).toMatchObject({ ok: false });
  });

  it('keeps repeated activation idempotent but refuses to switch Skills in one Run', () => {
    const runSnapshot = snapshot();
    const activeContext = {
      ...context(runSnapshot),
      activeSkillId: 'media-extract-audio',
    };
    const first = resolveAgentSkillActivationResult(
      { skillId: 'media-extract-audio' },
      activeContext,
    );
    const repeated = resolveAgentSkillActivationResult(
      { skillId: 'media-extract-audio' },
      activeContext,
    );

    expect(repeated).toEqual(first);
    expect(resolveAgentSkillActivationResult(
      { skillId: 'another-skill' },
      activeContext,
    )).toMatchObject({
      message: expect.stringContaining('新建 Run'),
      ok: false,
    });
  });

  it('fits the complete deterministic result in the provider Tool-result ceiling', () => {
    const result = resolveAgentSkillActivationResult(
      { skillId: 'media-extract-audio' },
      context(snapshot()),
    );
    const projection = projectAgentToolResultForProvider(result, 1_024);

    expect(projection.truncated).toBe(false);
    expect(JSON.parse(projection.content)).toMatchObject({
      data: {
        instructions: mediaExtractAudioSkill.instructions,
        skillId: 'media-extract-audio',
      },
      ok: true,
    });
  });
});
