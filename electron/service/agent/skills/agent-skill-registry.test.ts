import { describe, expect, it } from 'vitest';

import {
  AGENT_SKILL_DEFAULT_MAX_ACTIVATION_TOKENS,
  createAgentSkillActivationEnvelope,
  createAgentSkillRegistry,
  getAgentSkillInstructionsHash,
  serializeAgentSkillActivationEnvelope,
} from './agent-skill-registry';
import type { AgentSkillDefinitionV1 } from './agent-skill.types';

function skill(overrides: Partial<AgentSkillDefinitionV1> = {}): AgentSkillDefinitionV1 {
  return {
    description: '从媒体文件提取音频',
    id: 'media-extract-audio',
    instructions: '先检查输入，再调用受控 Tool。\n完成后重新感知产物。',
    source: 'built-in',
    toolAllowlist: ['file.list', 'media.inspect', 'media.extractAudio'],
    version: '1.0.0',
    whenToUse: '用户要求从一个明确的音视频文件提取音轨时。',
    ...overrides,
  };
}

describe('Agent Skill V1 registry', () => {
  it('registers built-in definitions and returns a stable sorted catalog', () => {
    const registry = createAgentSkillRegistry({
      toolExists: () => true,
      estimateTokens: text => text.length,
      maxActivationTokens: 10_000,
      maxSummaryTokens: 10_000,
    });
    registry.register(skill({ id: 'z-last' }));
    registry.register(skill({ id: 'a-first' }));

    expect(registry.list().map(item => item.id)).toEqual(['a-first', 'z-last']);
    expect(registry.list()).not.toBe(registry.list());
    expect(registry.get(' a-first ')?.id).toBe('a-first');
    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(Object.isFrozen(registry.get('a-first'))).toBe(true);
  });

  it('deep-copies and freezes definitions, including the Tool allowlist', () => {
    const input = {
      ...skill(),
      toolAllowlist: [...skill().toolAllowlist],
    } as {
      description: string;
      id: string;
      instructions: string;
      source: 'built-in';
      toolAllowlist: string[];
      version: string;
      whenToUse: string;
    };
    const registry = createAgentSkillRegistry({
      toolExists: () => true,
      estimateTokens: text => text.length,
      maxActivationTokens: 10_000,
      maxSummaryTokens: 10_000,
    });
    registry.register(input);
    input.description = 'changed after registration';
    input.toolAllowlist[0] = 'evil.tool';

    const registered = registry.get(input.id);
    expect(registered?.description).toBe('从媒体文件提取音频');
    expect(registered?.toolAllowlist).toEqual([
      'file.list',
      'media.inspect',
      'media.extractAudio',
    ]);
    expect(Object.isFrozen(registered?.toolAllowlist)).toBe(true);
    expect(() => {
      (registered as { description: string }).description = 'tampered';
    }).toThrow();
  });

  it('rejects duplicate IDs, duplicate Tools, unknown Tools, and non built-in sources', () => {
    const knownTools = new Set(['file.list', 'media.inspect', 'media.extractAudio']);
    const registry = createAgentSkillRegistry({
      toolExists: toolName => knownTools.has(toolName),
      estimateTokens: text => text.length,
      maxActivationTokens: 10_000,
      maxSummaryTokens: 10_000,
    });
    registry.register(skill());
    expect(() => registry.register(skill())).toThrow('已注册');
    expect(() => registry.register(skill({
      id: 'duplicate-tools',
      toolAllowlist: ['file.list', 'file.list'],
    }))).toThrow('重复 Tool');
    expect(() => registry.register(skill({
      id: 'unknown-tool',
      toolAllowlist: ['does.not-exist'],
    }))).toThrow('未知 Tool');
    expect(() => registry.register(skill({
      id: 'external-source',
      source: 'remote' as 'built-in',
    }))).toThrow('built-in');
  });

  it('rejects invalid IDs, empty fields, unknown fields, and executable values', () => {
    const registry = createAgentSkillRegistry({
      estimateTokens: text => text.length,
      maxActivationTokens: 10_000,
      maxSummaryTokens: 10_000,
    });
    expect(() => registry.register(skill({ id: 'Not Valid' }))).toThrow('ID');
    expect(() => registry.register(skill({ description: '   ' }))).toThrow('不能为空');
    expect(() => registry.register(skill({ instructions: '' }))).toThrow('不能为空');
    expect(() => registry.register({
      ...skill(),
      id: 'unknown-field',
      callback: () => undefined,
    } as AgentSkillDefinitionV1 & { callback: () => void })).toThrow('不允许的字段');
    expect(() => registry.register({
      ...skill(),
      id: 'date-value',
      toolAllowlist: new Date() as unknown as readonly string[],
    })).toThrow();
  });

  it('checks summary and activation budgets with the injected estimator', () => {
    expect(() => createAgentSkillRegistry({
      estimateTokens: () => AGENT_SKILL_DEFAULT_MAX_ACTIVATION_TOKENS + 1,
    }).register(skill())).toThrow('超过 token 预算');

    const registry = createAgentSkillRegistry({
      estimateTokens: text => text.length,
      maxActivationTokens: 10_000,
      maxSummaryTokens: 10_000,
      maxCatalogTokens: 30,
    });
    registry.register(skill({ id: 'one' }));
    registry.register(skill({ id: 'two' }));
    expect(() => registry.createRunSnapshot()).toThrow('摘要目录');
  });

  it('freezes an isolated Run snapshot and keeps it stable after later registration', () => {
    const registry = createAgentSkillRegistry({
      toolExists: () => true,
      estimateTokens: text => text.length,
      maxActivationTokens: 10_000,
      maxSummaryTokens: 10_000,
    });
    registry.register(skill({ id: 'first' }));
    const snapshot = registry.createRunSnapshot();
    registry.register(skill({ id: 'second' }));

    expect(snapshot.catalogRevision).toBe(1);
    expect(snapshot.list().map(item => item.id)).toEqual(['first']);
    expect(snapshot.get('second')).toBeNull();
    expect(snapshot.listSummaries()[0]).toEqual({
      description: '从媒体文件提取音频',
      id: 'first',
      version: '1.0.0',
      whenToUse: '用户要求从一个明确的音视频文件提取音轨时。',
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.list())).toBe(true);
  });

  it('creates a deterministic activation envelope and content hash', () => {
    const definition = skill();
    const envelope = createAgentSkillActivationEnvelope(definition);
    expect(envelope).toEqual({
      instructions: definition.instructions,
      instructionsHash: getAgentSkillInstructionsHash(definition),
      skillId: definition.id,
      toolAllowlist: definition.toolAllowlist,
      version: definition.version,
    });
    expect(serializeAgentSkillActivationEnvelope(envelope))
      .toBe(serializeAgentSkillActivationEnvelope(createAgentSkillActivationEnvelope(definition)));
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(Object.isFrozen(envelope.toolAllowlist)).toBe(true);
  });

  it('exposes summaries and activation envelopes only from the Run snapshot', () => {
    const registry = createAgentSkillRegistry({
      toolExists: () => true,
      estimateTokens: text => text.length,
      maxActivationTokens: 10_000,
      maxSummaryTokens: 10_000,
    });
    registry.register(skill());
    const snapshot = registry.createRunSnapshot();
    expect(snapshot.getSummary('media-extract-audio')?.id).toBe('media-extract-audio');
    expect(snapshot.getActivationEnvelope('media-extract-audio')?.skillId)
      .toBe('media-extract-audio');
    expect(snapshot.getSummary('unknown')).toBeNull();
    expect(snapshot.getActivationEnvelope('unknown')).toBeNull();
  });
});
