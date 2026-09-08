import { describe, expect, it } from 'vitest';

import type {
  AgentChatStreamEvent,
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
