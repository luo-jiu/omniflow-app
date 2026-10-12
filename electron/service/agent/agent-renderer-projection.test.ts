import { describe, expect, it, vi } from 'vitest';

import type {
  AgentChatStreamEvent,
  AgentComputerSetTextPreparedActionPublicV1,
  AgentSessionSnapshot,
  AgentToolActivitySnapshot,
} from '@/shared/agent/agent.types';
import {
  projectAgentChatStreamEventForRenderer,
  projectAgentSessionForRenderer,
  projectAgentToolActivityForRenderer,
} from './agent-renderer-projection';
import { createAgentToolRegistry } from './agent-tool-registry';

const INSTRUCTIONS_HASH = 'a'.repeat(64);
const TEXT_BODY = '中🪟a';
const TEXT_ACTION: AgentComputerSetTextPreparedActionPublicV1 = { kind: 'computer.setText', version: 1, libraryId: 3,
  targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce', applicationLabel: 'OmniFlow', windowLabel: 'QA',
  observationId: '83fc584b-037d-4c82-8883-a609846ea0d4', elementId: '805f4b48-ec6e-4f78-b45b-e01f10bb247e',
  mode: 'replace', textLength: 3, textBytes: 8 };

function activity(toolName = 'skill.activate'): AgentToolActivitySnapshot {
  return {
    call: { id: 'call-1', input: { skillId: 'media-extract-audio' }, name: toolName },
    createdAt: '2026-08-24T00:00:00.000Z',
    finishedAt: '2026-08-24T00:00:01.000Z',
    id: 'tool-run-1',
    ordinal: 1,
    permissionBehavior: 'allow',
    result: {
      data: {
        instructions: '完整流程正文不得跨到 renderer',
        instructionsHash: INSTRUCTIONS_HASH,
        skillId: 'media-extract-audio',
        toolAllowlist: ['file.list'],
        version: '1.0.0',
      },
      message: '已加载 Skill media-extract-audio（1.0.0）',
      ok: true,
    },
    revision: 2,
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
  };
}

describe('Agent renderer projection', () => {
  it.each(['observe', 'click', 'setText', 'scroll'] as const)('classifies initial computer.%s prepare only for display without inventing action, approval or success', operation => {
    const name = `computer.${operation}`;
    const prepareMain = vi.fn(async () => { throw new Error('must not prepare while projecting'); });
    const execute = vi.fn(async () => ({ ok: true }));
    const registry = createAgentToolRegistry([{ name, registrationId: `builtin:${name}@1`, executor: 'main',
      risk: operation === 'observe' ? 'read' : 'write', description: name, inputSchema: { type: 'object' }, prepareMain, execute }]);
    const source: AgentToolActivitySnapshot = { ...activity(name), status: 'preparing', preparation: undefined, result: undefined,
      finishedAt: undefined, permissionBehavior: operation === 'observe' ? 'allow' : 'ask' };
    const projected = projectAgentToolActivityForRenderer(source, toolName => registry.get(toolName));
    expect(projected.toolMetadata?.builtinComputerTool).toBe(operation);
    expect(projected).toMatchObject({ status: 'preparing', permissionBehavior: source.permissionBehavior });
    expect(projected.preparation).toBeUndefined();
    expect(projected.approval).toBeUndefined();
    expect(projected.interaction).toBeUndefined();
    expect(projected.result).toBeUndefined();
    expect(prepareMain).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(source.toolMetadata).toBeUndefined();
    for (const invalid of [{ ...registry.get(name)!, prepareMain: undefined },
      { ...registry.get(name)!, risk: operation === 'observe' ? 'write' as const : 'read' as const }]) {
      expect(projectAgentToolActivityForRenderer(source, () => invalid).toolMetadata?.builtinComputerTool).toBeUndefined();
    }
  });

  it.each(['registration', 'name', 'executor', 'kind', 'plugin-source', 'plugin-operation', 'activity-plugin', 'missing-registry'] as const)(
    'does not trust %s to classify an initial computer prepare', cause => {
      const registry = createAgentToolRegistry([{ name: 'computer.scroll', registrationId: 'builtin:computer.scroll@1', executor: 'main', risk: 'write',
        description: 'Scroll', inputSchema: { type: 'object' }, prepareMain: async () => { throw new Error('not used'); }, execute: async () => ({ ok: true }) }]);
      let source: AgentToolActivitySnapshot = { ...activity('computer.scroll'), status: 'preparing', preparation: undefined,
        result: undefined, finishedAt: undefined, permissionBehavior: 'ask',
        toolMetadata: { kind: 'business', risk: 'write', builtinComputerTool: 'scroll' } };
      const tool = { ...registry.get('computer.scroll')! };
      const pluginSource = { pluginId: 'fake', pluginVersion: '1', packageFingerprint: 'fingerprint',
        toolId: 'scroll', registrationId: 'builtin:computer.scroll@1' };
      if (cause === 'registration') tool.registrationId = 'builtin:computer.scroll@2';
      if (cause === 'name') tool.name = 'computer.click';
      if (cause === 'executor') tool.executor = 'renderer';
      if (cause === 'kind') tool.kind = 'control';
      if (cause === 'plugin-source') tool.pluginSource = pluginSource;
      if (cause === 'plugin-operation') tool.pluginOperation = 'rename';
      if (cause === 'activity-plugin') source = { ...source, pluginSource };
      const projected = projectAgentToolActivityForRenderer(source, () => cause === 'missing-registry' ? null : tool);
      expect(projected.toolMetadata?.builtinComputerTool).toBeUndefined();
      expect(projected.preparation).toBeUndefined();
      expect(projected.result).toBeUndefined();
      expect(projected.status).toBe('preparing');
      expect(projected.permissionBehavior).toBe('ask');
    });

  it.each(['completed', 'running', 'failed', 'cancelled', 'interrupted', 'awaiting_approval', 'awaiting_interaction'] as const)(
    'does not invent a computer display action for an unprepared %s activity', status => {
      const registry = createAgentToolRegistry([{ name: 'computer.scroll', registrationId: 'builtin:computer.scroll@1', executor: 'main', risk: 'write',
        description: 'Scroll', inputSchema: { type: 'object' }, prepareMain: async () => { throw new Error('not used'); }, execute: async () => ({ ok: true }) }]);
      const source: AgentToolActivitySnapshot = { ...activity('computer.scroll'), status, preparation: undefined,
        result: undefined, finishedAt: undefined, permissionBehavior: 'ask' };
      const projected = projectAgentToolActivityForRenderer(source, name => registry.get(name));
      expect(projected.toolMetadata?.builtinComputerTool).toBeUndefined();
      expect(projected.status).toBe(status);
      expect(projected.preparation).toBeUndefined();
      expect(projected.result).toBeUndefined();
    });

  it('requires an initial prepare with no decision/result record and does not reinterpret malformed preparation as missing', () => {
    const registry = createAgentToolRegistry([{ name: 'computer.scroll', registrationId: 'builtin:computer.scroll@1', executor: 'main', risk: 'write',
      description: 'Scroll', inputSchema: { type: 'object' }, prepareMain: async () => { throw new Error('not used'); }, execute: async () => ({ ok: true }) }]);
    const initial: AgentToolActivitySnapshot = { ...activity('computer.scroll'), status: 'preparing', preparation: undefined,
      result: undefined, finishedAt: undefined, permissionBehavior: 'ask' };
    for (const overrides of [{ permissionBehavior: 'deny' }, { finishedAt: '2026-10-11T00:00:00.000Z' },
      { result: { ok: true } }, { result: { ok: false, data: { dispatchState: 'unknown' } } },
      { approval: { approvalId: 'approval', status: 'pending', preview: { title: 'Scroll', risk: 'write' } } },
      { approval: { approvalId: 'approval', status: 'approved', preview: { title: 'Scroll', risk: 'write' } } },
      { interaction: {} }, { preparation: { action: {} } }, { preparation: null }]) {
      const source = { ...initial, ...overrides } as unknown as AgentToolActivitySnapshot;
      const projected = projectAgentToolActivityForRenderer(source, name => registry.get(name));
      expect(projected.toolMetadata?.builtinComputerTool).toBeUndefined();
      expect(projected.status).toBe('preparing');
      expect(projected.permissionBehavior).toBe(source.permissionBehavior);
      expect(projected.preparation).toEqual(source.preparation);
      expect(projected.approval).toEqual(source.approval);
      expect(projected.result).toEqual(source.result);
    }
  });

  it('preserves main prepare failure and unknown receipt rather than turning display classification into a success', () => {
    const registry = createAgentToolRegistry([{ name: 'computer.scroll', registrationId: 'builtin:computer.scroll@1', executor: 'main', risk: 'write',
      description: 'Scroll', inputSchema: { type: 'object' }, prepareMain: async () => { throw new Error('not used'); }, execute: async () => ({ ok: true }) }]);
    const source: AgentToolActivitySnapshot = { ...activity('computer.scroll'), status: 'failed', preparation: undefined,
      permissionBehavior: 'deny', result: { ok: false, message: '控件已变化，此次未发送', data: { dispatchState: 'not-dispatched' } } };
    for (const state of ['not-dispatched', 'unknown'] as const) {
      source.result = { ...source.result!, data: { dispatchState: state } };
      const projected = projectAgentToolActivityForRenderer(source, name => registry.get(name));
      expect(projected.toolMetadata?.builtinComputerTool).toBeUndefined();
      expect(projected.status).toBe('failed');
      expect(projected.result).toEqual(source.result);
      expect(projected.permissionBehavior).toBe('deny');
      expect(projected.preparation).toBeUndefined();
    }
  });

  it.each(['setText', 'scroll'] as const)('marks computer.%s only with exact prepared main provenance', operation => {
    const name = `computer.${operation}`;
    const registry = createAgentToolRegistry([{ name, registrationId: `builtin:${name}@1`, executor: 'main', risk: 'write',
      description: name, inputSchema: { type: 'object' }, execute: async () => ({ ok: true }),
      prepareMain: async () => { throw new Error('not used'); } }]);
    const action = operation === 'setText' ? TEXT_ACTION : { kind: 'computer.scroll' as const, version: 1 as const,
      libraryId: TEXT_ACTION.libraryId, targetId: TEXT_ACTION.targetId, applicationLabel: TEXT_ACTION.applicationLabel,
      windowLabel: TEXT_ACTION.windowLabel, observationId: TEXT_ACTION.observationId, elementId: TEXT_ACTION.elementId,
      direction: 'down' as const, unit: 'page' as const };
    const source = { ...activity(name), preparation: { preparedActionId: 'prepared', snapshotHash: 'hash', action } };
    const project = (value: AgentToolActivitySnapshot) => projectAgentToolActivityForRenderer(value, toolName => registry.get(toolName));
    expect(project(source).toolMetadata?.builtinComputerTool).toBe(operation);
    expect(project({ ...source, preparation: undefined }).toolMetadata?.builtinComputerTool).toBeUndefined();
    const unprepared = { ...registry.get(name)!, prepareMain: undefined };
    expect(projectAgentToolActivityForRenderer(source, () => unprepared).toolMetadata?.builtinComputerTool).toBeUndefined();
    const spoofed = { ...registry.get(name)!, pluginOperation: 'rename' as const };
    expect(projectAgentToolActivityForRenderer(source, () => spoofed).toolMetadata?.builtinComputerTool).toBeUndefined();
  });

  it('removes legacy text bodies from activity, approval, progress and receipt without trusting old provenance', () => {
    const source = activity('computer.setText');
    source.call.input = { observationId: TEXT_ACTION.observationId, elementId: TEXT_ACTION.elementId, mode: 'replace', text: TEXT_BODY };
    source.preparation = { preparedActionId: 'prepared', snapshotHash: 'hash', action: TEXT_ACTION };
    source.approval = { approvalId: 'approval', status: 'approved', preview: { title: TEXT_BODY, description: TEXT_BODY, risk: 'write' } };
    source.progress = { message: TEXT_BODY };
    source.result = { ok: true, message: TEXT_BODY, data: { ...TEXT_ACTION, operation: 'computer.setText',
      operationId: TEXT_ACTION.observationId, dispatchState: 'dispatched', mutationCommitState: 'committed',
      nextAction: 'observe', retryAllowed: false, text: TEXT_BODY, textHash: 'private-text-hash' } };
    const projected = projectAgentToolActivityForRenderer(source, () => null);
    expect(projected.call.input).toEqual({ observationId: TEXT_ACTION.observationId, elementId: TEXT_ACTION.elementId,
      mode: 'replace', textLength: 3, textBytes: 8 });
    expect(projected.progress).toEqual({ message: '正在输入文字' });
    expect(projected.result).toMatchObject({ ok: true, message: '已发送文字输入', data: { dispatchState: 'dispatched' } });
    expect(projected.toolMetadata).toBeUndefined();
    const approval = { approvalId: 'approval', call: source.call, preparation: source.preparation,
      preview: source.approval.preview, runId: source.runId, sessionId: source.sessionId };
    for (const event of [{ type: 'tool-completed', activity: source, call: source.call, result: source.result },
      { type: 'tool-approval-required', approval }, { type: 'tool-progress', activity: source, progress: source.progress }]) {
      const output = projectAgentChatStreamEventForRenderer({ ...event, runId: source.runId, sessionId: source.sessionId } as AgentChatStreamEvent);
      expect(JSON.stringify(output)).not.toContain(TEXT_BODY);
      expect(JSON.stringify(output)).not.toContain('private-text-hash');
    }
    const getter = vi.fn(() => TEXT_BODY);
    const malformed = { ...source, call: { ...source.call, input: Object.defineProperty({ mode: 'replace' }, 'text', { get: getter }) },
      preparation: { ...source.preparation, action: { ...TEXT_ACTION, text: TEXT_BODY } } } as unknown as AgentToolActivitySnapshot;
    const protectedOutput = projectAgentToolActivityForRenderer(malformed, () => null);
    expect(protectedOutput.preparation).toBeUndefined();
    expect(protectedOutput.result).toMatchObject({ ok: false, data: { dispatchState: 'unknown' } });
    expect(getter).not.toHaveBeenCalled();
    expect(JSON.stringify(protectedOutput)).not.toContain(TEXT_BODY);
    expect(source.call.input).toHaveProperty('text', TEXT_BODY);
  });

  it('redacts rejected legacy provider-alias records without granting builtin metadata or preserving a forged prepared action', () => {
    const source = activity('computer_setText');
    source.permissionBehavior = 'deny';
    source.status = 'failed';
    source.call.input = { observationId: TEXT_ACTION.observationId, elementId: TEXT_ACTION.elementId,
      mode: 'replace', text: TEXT_BODY, nested: { body: TEXT_BODY } };
    source.toolMetadata = { builtinComputerTool: 'setText', kind: 'business', risk: 'write' };
    source.preparation = { preparedActionId: 'forged', snapshotHash: 'forged', action: TEXT_ACTION };
    source.approval = { approvalId: 'forged', status: 'denied', preview: { title: TEXT_BODY, description: TEXT_BODY, risk: 'write' } };
    source.progress = { message: TEXT_BODY };
    source.result = { ok: false, message: TEXT_BODY, data: { text: TEXT_BODY, textHash: 'private-alias-text-hash' } };
    const prepareMain = vi.fn(async () => { throw new Error('must not prepare while projecting'); });
    const execute = vi.fn(async () => ({ ok: true }));
    const registry = createAgentToolRegistry([{ name: 'computer.setText', registrationId: 'builtin:computer.setText@1',
      description: 'Text', risk: 'write', inputSchema: { type: 'object' }, prepareMain, execute }]);
    const projected = projectAgentToolActivityForRenderer(source, () => registry.get('computer.setText'));
    expect(projected.call).toEqual({ id: source.call.id, name: 'computer_setText', input: {
      observationId: TEXT_ACTION.observationId, elementId: TEXT_ACTION.elementId, mode: 'replace', textLength: 3, textBytes: 8,
    } });
    expect(projected).toMatchObject({ permissionBehavior: 'deny', status: 'failed',
      result: { ok: false, message: '文字输入未发送，请重新查看窗口' } });
    expect(projected.toolMetadata?.builtinComputerTool).toBeUndefined();
    expect(projected.preparation).toBeUndefined();
    const session = { createdAt: source.createdAt, id: source.sessionId, lastMessagePreview: '', libraryId: 3,
      messageCount: 0, messages: [], runs: [], title: '历史拒绝记录', toolActivities: [source], updatedAt: source.createdAt } satisfies AgentSessionSnapshot;
    for (const output of [projected, projectAgentSessionForRenderer(session), ...[
      { type: 'tool-started', activity: source, call: source.call },
      { type: 'tool-progress', activity: source, callId: source.call.id, progress: source.progress },
      { type: 'tool-completed', activity: source, call: source.call, result: source.result },
      { type: 'tool-completed', call: source.call, result: source.result },
      { type: 'error', message: '任务失败', toolActivities: [source] },
    ].map(event => projectAgentChatStreamEventForRenderer({ ...event, runId: source.runId,
      sessionId: source.sessionId } as AgentChatStreamEvent))]) {
      expect(JSON.stringify(output)).not.toContain(TEXT_BODY);
      expect(JSON.stringify(output)).not.toContain('private-alias-text-hash');
    }
    expect(prepareMain).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(source.call.input).toHaveProperty('text', TEXT_BODY);
    expect(source.preparation.action).toEqual(TEXT_ACTION);
  });

  it('keeps an independently allowed provider-alias activity on its ordinary presentation path', () => {
    const source = activity('computer_setText');
    source.call.input = { text: TEXT_BODY };
    source.status = 'failed';
    source.result = { ok: false, message: 'Independent alias failure' };
    expect(projectAgentToolActivityForRenderer(source, () => null)).toBe(source);
    const event = { type: 'tool-completed', activity: source, call: source.call, result: source.result,
      runId: source.runId, sessionId: source.sessionId } as AgentChatStreamEvent;
    expect(projectAgentChatStreamEventForRenderer(event)).toEqual(event);
  });

  it('keeps only the stable Skill activation identity in Tool activities', () => {
    const source = activity();
    const projected = projectAgentToolActivityForRenderer(source);

    expect(projected.result).toEqual({
      data: {
        instructionsHash: INSTRUCTIONS_HASH,
        skillId: 'media-extract-audio',
        version: '1.0.0',
      },
      message: '已加载 Skill media-extract-audio（1.0.0）',
      ok: true,
    });
    expect(JSON.stringify(projected)).not.toContain('完整流程正文');
    expect(source.result?.data).toHaveProperty('instructions');
  });

  it('does not rewrite ordinary business Tool activities', () => {
    const source = activity('ordinary.tool');
    expect(projectAgentToolActivityForRenderer(source)).toBe(source);
  });

  it('projects only registry-owned grouping metadata to renderer activities', () => {
    const registry = createAgentToolRegistry([{
      description: 'List visible resources',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'file.list',
      presentation: { groupKind: 'resource-read', operationKind: 'list' },
      risk: 'read',
    }, {
      description: 'Write a visible resource',
      execute: async () => ({ ok: true }),
      inputSchema: { type: 'object' },
      name: 'file.write',
      risk: 'write',
    }]);

    expect(projectAgentToolActivityForRenderer(
      activity('file.list'),
      name => registry.get(name),
    )).toMatchObject({
      toolMetadata: {
        groupKind: 'resource-read',
        kind: 'business',
        operationKind: 'list',
        risk: 'read',
      },
    });
    expect(projectAgentToolActivityForRenderer(
      activity('file.write'),
      name => registry.get(name),
    ).toolMetadata).toEqual({ kind: 'business', risk: 'write' });
    expect(projectAgentToolActivityForRenderer(
      { ...activity('missing.tool'), toolMetadata: {
        groupKind: 'resource-read',
        kind: 'business',
        operationKind: 'read',
        risk: 'read',
      } },
      name => registry.get(name),
    ).toolMetadata).toBeUndefined();
  });

  it('keeps Shell tails but removes main-only log identities', () => {
    const source = activity('shell.run');
    source.result = {
      data: {
        executionId: 'execution-secret',
        logRef: `log:v1:${'e'.repeat(64)}`,
        providerOutput: {
          stdout: { head: 'provider-only output' },
          version: 1,
        },
        status: 'completed',
        stdoutTail: 'done',
      },
      message: 'Shell 命令执行完成',
      ok: true,
    };

    const projected = projectAgentToolActivityForRenderer(source);
    expect(projected.result).toEqual({
      data: { status: 'completed', stdoutTail: 'done' },
      message: 'Shell 命令执行完成',
      ok: true,
    });
    expect(JSON.stringify(projected)).not.toContain('execution-secret');
    expect(JSON.stringify(projected)).not.toContain('log:v1:');
    expect(JSON.stringify(projected)).not.toContain('provider-only output');
  });

  it('marks only exact main-owned computer registrations with canonical preparation', () => {
    const registry = createAgentToolRegistry([{
      name: 'computer.observe', registrationId: 'builtin:computer.observe@1', executor: 'main',
      description: 'Observe', inputSchema: { type: 'object' }, risk: 'read', execute: async () => ({ ok: true }),
    }]);
    const source = activity('computer.observe');
    source.preparation = { preparedActionId: 'prepared', snapshotHash: 'hash',
      action: { kind: 'computer.observe', version: 1, libraryId: 3, displayId: '1', displayLabel: 'Screen' } };
    const project = (value: AgentToolActivitySnapshot) => projectAgentToolActivityForRenderer(value, name => registry.get(name));
    expect(project(source).toolMetadata?.builtinComputerTool).toBe('observe');
    expect(project({ ...source, preparation: undefined }).toolMetadata?.builtinComputerTool).toBeUndefined();
    expect(project({ ...source, pluginSource: { pluginId: 'fake', pluginVersion: '1', packageFingerprint: 'fingerprint',
      toolId: 'observe', registrationId: 'builtin:computer.observe@1' } }).toolMetadata?.builtinComputerTool).toBeUndefined();
    const forged = { ...source, preparation: { ...source.preparation,
      action: { ...source.preparation.action, extra: 'forged' } } } as unknown as AgentToolActivitySnapshot;
    expect(project(forged).toolMetadata?.builtinComputerTool).toBeUndefined();
    const impostor = createAgentToolRegistry([{
      name: 'computer.observe', registrationId: 'other:computer.observe', executor: 'main',
      description: 'Observe', inputSchema: { type: 'object' }, risk: 'read', execute: async () => ({ ok: true }),
    }]);
    expect(projectAgentToolActivityForRenderer(source, name => impostor.get(name)).toolMetadata?.builtinComputerTool).toBeUndefined();
  });

  it('discards incoming computer provenance when the registry cannot establish it', () => {
    const source = { ...activity('computer.observe'), toolMetadata: {
      kind: 'business' as const, risk: 'read' as const, builtinComputerTool: 'observe' as const,
    } };
    expect(projectAgentToolActivityForRenderer(source, () => null).toolMetadata).toBeUndefined();
  });

  it.each(['observe', 'click'] as const)('marks canonical V2 computer.%s actions using the established built-in registration', operation => {
    const name = `computer.${operation}`;
    const registry = createAgentToolRegistry([{
      name, registrationId: `builtin:${name}@1`, executor: 'main', risk: operation === 'observe' ? 'read' : 'write',
      description: name, inputSchema: { type: 'object' }, execute: async () => ({ ok: true }),
    }]);
    const source = activity(name);
    const target = { version: 2 as const, libraryId: 3, targetId: '237e3952-2a40-4c7b-b2f4-bec335a79cce',
      applicationLabel: 'OmniFlow', windowLabel: '测试窗口' };
    source.preparation = { preparedActionId: 'prepared', snapshotHash: 'hash', action: operation === 'observe'
      ? { kind: 'computer.observe', ...target }
      : { kind: 'computer.click', ...target, observationId: '83fc584b-037d-4c82-8883-a609846ea0d4',
        screenshotWidth: 1024, screenshotHeight: 640, x: 300, y: 200, button: 'left', clickCount: 1 } };
    const project = (value: AgentToolActivitySnapshot) => projectAgentToolActivityForRenderer(value, toolName => registry.get(toolName));
    expect(project(source).toolMetadata?.builtinComputerTool).toBe(operation);
    for (const overrides of [{ targetId: '500' }, { pid: 500 }, { windowLabel: '\ud800' }]) {
      const forged = { ...source, preparation: { ...source.preparation, action: { ...source.preparation.action, ...overrides } } } as unknown as AgentToolActivitySnapshot;
      expect(project(forged).toolMetadata?.builtinComputerTool).toBeUndefined();
    }
    expect(project({ ...source, pluginSource: { pluginId: 'fake', pluginVersion: '1', packageFingerprint: 'fingerprint',
      toolId: operation, registrationId: `builtin:${name}@1` } }).toolMetadata?.builtinComputerTool).toBeUndefined();
  });

  it('redacts both live event results and canonical activity arrays', () => {
    const sourceActivity = activity();
    const event = {
      activity: sourceActivity,
      call: sourceActivity.call,
      result: sourceActivity.result,
      runId: 'run-1',
      sessionId: 'session-1',
      toolActivities: [sourceActivity],
      type: 'tool-completed',
    } as AgentChatStreamEvent;
    const projected = projectAgentChatStreamEventForRenderer(event);

    expect(JSON.stringify(projected)).not.toContain('完整流程正文');
    expect((projected as AgentChatStreamEvent & {
      result?: { data?: unknown };
    }).result?.data).toEqual({
      instructionsHash: INSTRUCTIONS_HASH,
      skillId: 'media-extract-audio',
      version: '1.0.0',
    });
  });

  it('redacts restored session snapshots without changing persisted input', () => {
    const sourceActivity = activity();
    const session = {
      createdAt: '2026-08-24T00:00:00.000Z',
      id: 'session-1',
      lastMessagePreview: '',
      libraryId: 3,
      messageCount: 0,
      messages: [],
      runs: [],
      title: '测试会话',
      toolActivities: [sourceActivity],
      updatedAt: '2026-08-24T00:00:01.000Z',
    } satisfies AgentSessionSnapshot;

    expect(JSON.stringify(projectAgentSessionForRenderer(session))).not.toContain('完整流程正文');
    expect(sourceActivity.result?.data).toHaveProperty('instructions');
  });
});
