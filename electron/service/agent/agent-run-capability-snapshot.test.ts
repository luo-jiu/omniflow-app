import { describe, expect, it, vi } from 'vitest';

import {
  createAgentRunCapabilitySnapshot,
  type AgentRunCapabilityToolKind,
} from './agent-run-capability-snapshot';
import { createAgentToolRegistry, type AgentTool } from './agent-tool-registry';
import { createAgentSkillRegistry } from './skills/agent-skill-registry';
import type { AgentSkillDefinitionV1 } from './skills/agent-skill.types';

function tool(
  name: string,
  kind: AgentRunCapabilityToolKind = 'business',
  execute = vi.fn(async () => ({ message: name, ok: true })),
): AgentTool {
  // `kind` is consumed from the built-in registry contract. The field is
  // intentionally cast here until the registry's public type is updated.
  return {
    description: name,
    execute,
    inputSchema: { type: 'object' },
    kind,
    name,
    risk: 'read',
  } as AgentTool;
}

function skill(overrides: Partial<AgentSkillDefinitionV1> = {}): AgentSkillDefinitionV1 {
  return {
    description: '测试流程',
    id: 'test.skill',
    instructions: '先读取，再执行，最后重新感知。',
    source: 'built-in',
    toolAllowlist: ['file.list'],
    version: '1.0.0',
    whenToUse: '用于测试 Skill 能力收窄。',
    ...overrides,
  };
}

function createFixture() {
  const executeList = vi.fn(async () => ({ message: 'file.list', ok: true }));
  const registry = createAgentToolRegistry([
    tool('file.list', 'business', executeList),
    tool('file.stat'),
    tool('skill.activate', 'control'),
  ]);
  const skills = createAgentSkillRegistry({
    estimateTokens: text => text.length,
    maxActivationTokens: 10_000,
    maxCatalogTokens: 10_000,
    maxSummaryTokens: 10_000,
    toolExists: name => registry.get(name) !== null,
  });
  skills.register(skill());
  return {
    executeList,
    registry,
    skills,
    snapshot: createAgentRunCapabilitySnapshot({
      skillSnapshot: skills.createRunSnapshot(),
      toolSnapshot: registry.createSnapshot(),
    }),
  };
}

describe('Agent Run capability snapshot', () => {
  it('keeps controls visible and intersects business Tools with the active Skill allowlist', () => {
    const { snapshot } = createFixture();

    expect(snapshot.listTools().map(item => item.name)).toEqual([
      'file.list',
      'file.stat',
      'skill.activate',
    ]);
    expect(snapshot.listTools('test.skill').map(item => item.name)).toEqual([
      'file.list',
      'skill.activate',
    ]);
    expect(snapshot.listBusinessTools('test.skill').map(item => item.name)).toEqual(['file.list']);
    expect(snapshot.listControlTools('test.skill').map(item => item.name)).toEqual(['skill.activate']);
    expect(snapshot.isToolVisible('file.stat', 'test.skill')).toBe(false);
    expect(snapshot.getTool('file.stat', 'test.skill')).toBeNull();
    expect(snapshot.getToolKind('skill.activate')).toBe('control');
  });

  it('rejects unknown active Skills instead of widening or silently falling back', () => {
    const { snapshot } = createFixture();

    expect(() => snapshot.listTools('missing.skill')).toThrow('Agent Skill 不存在');
    expect(() => snapshot.validateInput('file.stat', {}, 'test.skill')).toThrow('未被 Run capability');
    expect(() => snapshot.execute('file.stat', {}, {
      appContext: { platform: 'darwin', selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: new AbortController().signal,
    }, 'test.skill')).toThrow('未被 Run capability');
  });

  it('executes and validates only through the captured Tool snapshot', async () => {
    const { executeList, snapshot } = createFixture();
    const context = {
      appContext: { platform: 'darwin' as const, selectedNodeIds: [] },
      onProgress: () => undefined,
      signal: new AbortController().signal,
    };

    expect(snapshot.validateInput('file.list', {}, 'test.skill')).toEqual({ ok: true });
    await expect(snapshot.execute('file.list', {}, context, 'test.skill')).resolves.toEqual({
      message: 'file.list',
      ok: true,
    });
    expect(executeList).toHaveBeenCalledTimes(1);
    expect(() => snapshot.validateInput('file.stat', {}, 'test.skill')).toThrow();
  });

  it('remains stable after live registries receive later definitions', () => {
    const { registry, skills, snapshot } = createFixture();
    const identity = snapshot.identity;

    registry.register(tool('file.new'));
    skills.register(skill({ id: 'later.skill', toolAllowlist: ['file.new'] }));

    expect(snapshot.identity).toBe(identity);
    expect(snapshot.listTools().map(item => item.name)).toEqual([
      'file.list',
      'file.stat',
      'skill.activate',
    ]);
    expect(snapshot.getSkill('later.skill')).toBeNull();
    expect(snapshot.getSkillSummary('test.skill')?.id).toBe('test.skill');
    expect(snapshot.getSkillActivationEnvelope('test.skill')?.skillId).toBe('test.skill');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.tools)).toBe(true);
    expect(Object.isFrozen(snapshot.skills)).toBe(true);
  });

  it('produces the same identity for equivalent Tool and Skill definitions in another order', () => {
    const first = createFixture().snapshot;
    const registry = createAgentToolRegistry([
      tool('skill.activate', 'control'),
      tool('file.stat'),
      tool('file.list'),
    ]);
    const skills = createAgentSkillRegistry({
      estimateTokens: text => text.length,
      maxActivationTokens: 10_000,
      maxCatalogTokens: 10_000,
      maxSummaryTokens: 10_000,
      toolExists: name => registry.get(name) !== null,
    });
    skills.register(skill());
    const second = createAgentRunCapabilitySnapshot({
      skillSnapshot: skills.createRunSnapshot(),
      toolSnapshot: registry.createSnapshot(),
    });

    expect(second.identity).toBe(first.identity);
  });
});

