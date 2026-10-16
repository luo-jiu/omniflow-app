import { describe, expect, it, vi } from 'vitest';
import { resolveAgentRunPermissionDecision } from './agent-permission-gate';
import type { AgentPreparedActionPublic } from '@/shared/agent/agent.types';
import { normalizeAgentPreparedActionPublic } from '../../../src/shared/agent/agent-prepared-action';
import { createAgentToolRegistry, type AgentToolPermissionDecision, type AgentToolSnapshot } from './agent-tool-registry';
import { getBuiltInAgentComputerTools } from './tools/computer-tools';

vi.mock('./computer/agent-computer-service-runtime', () => ({ agentComputerRuntime: {} }));

describe('Run permissions for built-in writes', () => {
  const ask: AgentToolPermissionDecision = { behavior: 'ask', risk: 'write', preview: { title: 'write', description: 'write', risk: 'write' } };
  it('auto-authorizes known non-destructive operations only in full-access', () => {
    for (const mode of ['ask', 'auto'] as const) expect(resolveAgentRunPermissionDecision('directory.create', ask, mode)).toBe(ask);
    expect(resolveAgentRunPermissionDecision('directory.create', ask, 'full-access')).toEqual({ behavior: 'allow', risk: 'write' });
    const media = { kind: 'media.extractAudio', conflictPolicy: 'auto_rename' } as AgentPreparedActionPublic;
    expect(resolveAgentRunPermissionDecision('media.extractAudio', ask, 'full-access', media)).toEqual({ behavior: 'allow', risk: 'write' });
    expect(resolveAgentRunPermissionDecision('media.extractAudio', ask, 'full-access', { ...media, conflictPolicy: 'replace' } as AgentPreparedActionPublic)).toBe(ask);
  });
  it('does not override deny, arbitrary tools, missing preparation, memory or destructive decisions', () => {
    const deny: AgentToolPermissionDecision = { behavior: 'deny', risk: 'write', message: 'denied' };
    expect(resolveAgentRunPermissionDecision('directory.create', deny, 'full-access')).toBe(deny);
    for (const name of ['unknown', 'memory.propose', 'shell.run', 'file.upload']) {
      expect(resolveAgentRunPermissionDecision(name, ask, 'full-access')).toBe(ask);
    }
    const destructive = { ...ask, risk: 'destructive' as const };
    expect(resolveAgentRunPermissionDecision('directory.create', destructive, 'full-access')).toBe(destructive);
  });
});

describe('Run permissions for prepared built-in computer tools', () => {
  const target = { libraryId: 3, targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
    applicationLabel: 'Electron', windowLabel: 'OmniFlow QA' };
  const element = { ...target, observationId: '83fc584b-037d-4c82-8883-a609846ea0d4',
    elementId: '805f4b48-ec6e-4f78-b45b-e01f10bb247e' };
  const actions = [
    { kind: 'computer.windows', version: 1, libraryId: 3, application: 'Electron' },
    { kind: 'computer.observe', version: 2, ...target, mode: 'both', operations: ['press'], inputOperations: ['shortcut'] },
    { kind: 'computer.click', version: 3, ...element, button: 'left', clickCount: 1 },
    { kind: 'computer.setText', version: 1, ...element, mode: 'replace', textLength: 3, textBytes: 8 },
    { kind: 'computer.menu', version: 1, ...element, elementLabel: '打开菜单', operation: 'open' },
    { kind: 'computer.scroll', version: 1, ...element, direction: 'down', unit: 'page' },
    { kind: 'computer.input', version: 1, ...target, observationId: element.observationId,
      operation: 'shortcut', shortcut: { key: 'a', modifiers: ['command'] } },
  ].map(normalizeAgentPreparedActionPublic);

  function computerSnapshot() {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' });
      return createAgentToolRegistry(getBuiltInAgentComputerTools()).createSnapshot();
    } finally { Object.defineProperty(process, 'platform', platform); }
  }

  function askFor(tool: AgentToolSnapshot): AgentToolPermissionDecision {
    return { behavior: 'ask', risk: tool.risk, preview: { title: tool.name, description: tool.name, risk: tool.risk } };
  }

  it.each(actions)('authorizes prepared $kind only in full-access, including first read sharing', action => {
    const tool = computerSnapshot().get(action.kind)!;
    const ask = askFor(tool);
    expect(Object.isFrozen(tool)).toBe(true);
    for (const mode of [undefined, 'ask', 'auto'] as const) {
      expect(resolveAgentRunPermissionDecision(tool.name, ask, mode, action, tool)).toBe(ask);
    }
    expect(resolveAgentRunPermissionDecision(tool.name, ask, 'full-access', action, tool))
      .toEqual({ behavior: 'allow', risk: tool.risk });
  });

  it.each(actions)('preserves denial and unrecognized risk for $kind', action => {
    const tool = computerSnapshot().get(action.kind)!;
    const deny: AgentToolPermissionDecision = { behavior: 'deny', risk: tool.risk, message: 'not permitted' };
    expect(resolveAgentRunPermissionDecision(tool.name, deny, 'full-access', action, tool)).toBe(deny);
    for (const risk of ['destructive', 'external', tool.risk === 'read' ? 'write' : 'read'] as const) {
      const ask: AgentToolPermissionDecision = { behavior: 'ask', risk, preview: { title: 'changed risk', description: 'changed risk', risk } };
      expect(resolveAgentRunPermissionDecision(tool.name, ask, 'full-access', action, tool)).toBe(ask);
    }
  });

  it.each(actions)('requires the trusted main registration and matching preparation for $kind', action => {
    const tool = computerSnapshot().get(action.kind)!;
    const ask = askFor(tool);
    const untrusted: (AgentToolSnapshot | undefined)[] = [
      undefined,
      { ...tool, name: 'computer.unknown' },
      { ...tool, registrationId: `builtin:${tool.name}@999` },
      { ...tool, executor: 'renderer' },
      { ...tool, kind: 'control' },
      { ...tool, preparedRisk: 'dynamic' },
      { ...tool, pluginSource: {} as NonNullable<AgentToolSnapshot['pluginSource']> },
      { ...tool, pluginOperation: 'rename' },
      { ...tool, prepareMain: undefined },
      { ...tool, execute: undefined },
    ];
    for (const candidate of untrusted) {
      expect(resolveAgentRunPermissionDecision(tool.name, ask, 'full-access', action, candidate)).toBe(ask);
    }
    expect(resolveAgentRunPermissionDecision(tool.name, ask, 'full-access', undefined, tool)).toBe(ask);
    const mismatched = actions.find(candidate => candidate.kind !== tool.name)!;
    expect(resolveAgentRunPermissionDecision(tool.name, ask, 'full-access', mismatched, tool)).toBe(ask);
  });

  it('keeps historical display-wide observation and clicking outside automatic window grants', () => {
    const snapshot = computerSnapshot();
    const observe = snapshot.get('computer.observe')!;
    const click = snapshot.get('computer.click')!;
    const legacyObserve = normalizeAgentPreparedActionPublic({ kind: 'computer.observe', version: 1, libraryId: 3,
      displayId: 'display-1', displayLabel: 'Display 1' });
    const legacyClick = normalizeAgentPreparedActionPublic({ kind: 'computer.click', version: 1, libraryId: 3,
      displayId: 'display-1', displayLabel: 'Display 1', observationId: element.observationId,
      screenshotWidth: 1280, screenshotHeight: 800, x: 2, y: 3, button: 'left', clickCount: 1 });
    for (const [tool, action] of [[observe, legacyObserve], [click, legacyClick]] as const) {
      const ask = askFor(tool);
      expect(resolveAgentRunPermissionDecision(tool.name, ask, 'full-access', action, tool)).toBe(ask);
    }
  });
});
