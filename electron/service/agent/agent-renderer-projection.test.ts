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
    const source = activity('file.list');
    expect(projectAgentToolActivityForRenderer(source)).toBe(source);
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
