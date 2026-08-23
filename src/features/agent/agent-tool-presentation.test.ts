import { describe, expect, it } from 'vitest';

import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import { buildAgentToolPresentation } from './agent-tool-presentation';

function completedActivity(
  toolName: string,
  data: unknown,
): AgentToolActivitySnapshot {
  return {
    call: { id: 'call-1', input: {}, name: toolName },
    createdAt: '2026-08-23T00:00:00.000Z',
    finishedAt: '2026-08-23T00:00:01.000Z',
    id: 'activity-1',
    ordinal: 1,
    permissionBehavior: 'allow',
    revision: 1,
    result: { data, message: '完成', ok: true },
    runId: 'run-1',
    sessionId: 'session-1',
    status: 'completed',
  };
}

describe('Agent Tool presentation registry', () => {
  it('creates only a semantic tree action for a persisted library artifact', () => {
    const blocks = buildAgentToolPresentation(completedActivity('media.extractAudio', {
      createdNodeId: 22,
      format: 'm4a',
      name: 'movie-audio.m4a',
      parentId: 10,
      verified: true,
    }), 3);

    expect(blocks).toEqual([expect.objectContaining({
      actions: [{
        action: 'tree.revealNode',
        label: '在目录树中定位',
        libraryId: 3,
        nodeId: 22,
      }],
      artifact: expect.objectContaining({ kind: 'audio', name: 'movie-audio.m4a', nodeId: 22 }),
      type: 'artifact',
    })]);
  });

  it('whitelists media metadata instead of rendering arbitrary Tool result fields', () => {
    const blocks = buildAgentToolPresentation(completedActivity('media.inspect', {
      file: { name: 'movie.mp4', nodeId: 8 },
      format: {
        durationSeconds: 62,
        longName: 'QuickTime / MOV',
        secret: 'must-not-render',
        sizeBytes: 1024,
      },
      sourceUrl: 'https://storage.example/signed?secret=value',
      streamCount: 2,
    }), 3);

    expect(JSON.stringify(blocks)).toContain('QuickTime / MOV');
    expect(JSON.stringify(blocks)).not.toContain('must-not-render');
    expect(JSON.stringify(blocks)).not.toContain('sourceUrl');
    expect(JSON.stringify(blocks)).not.toContain('storage.example');
  });

  it('does not create an artifact action for an invalid node identity', () => {
    const blocks = buildAgentToolPresentation(completedActivity('directory.create', {
      createdNodeId: 0,
      name: '测试',
    }), 3);

    expect(blocks).toEqual([{ message: '完成', tone: 'success', type: 'notice' }]);
  });

  it('projects only controlled choice fields from a persisted interaction', () => {
    const activity = completedActivity('interaction.request', {});
    activity.status = 'awaiting_interaction';
    activity.interaction = {
      interactionId: 'interaction-1',
      request: {
        kind: 'choice',
        options: [
          { description: '说明', id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        prompt: '请选择',
        submitLabel: '继续',
        title: '确认格式',
      },
      status: 'pending',
    };

    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      interactionId: 'interaction-1',
      options: [
        { description: '说明', id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      prompt: '请选择',
      status: 'pending',
      submitLabel: '继续',
      title: '确认格式',
      type: 'choice',
    }]);
  });

  it('keeps a submitted form response read-only in its controlled projection', () => {
    const activity = completedActivity('interaction.request', {});
    activity.interaction = {
      interactionId: 'interaction-2',
      request: {
        fields: [{ id: 'name', label: '名称', required: true, type: 'text' }],
        kind: 'form',
        prompt: '请输入名称',
      },
      response: { kind: 'form', values: { name: '测试' } },
      status: 'submitted',
    };

    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      fields: [{ id: 'name', label: '名称', required: true, type: 'text' }],
      interactionId: 'interaction-2',
      prompt: '请输入名称',
      response: { kind: 'form', values: { name: '测试' } },
      status: 'submitted',
      type: 'form',
    }]);
  });
});
