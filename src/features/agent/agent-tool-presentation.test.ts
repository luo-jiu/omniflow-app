import { describe, expect, it } from 'vitest';

import type { AgentToolActivitySnapshot } from '@/shared/agent/agent.types';
import {
  buildAgentToolPresentation,
  getAgentToolNameTitle,
} from './agent-tool-presentation';

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
  it.each([
    ['file.stage', '暂存文件'],
    ['file.publish', '发布 Agent 输出'],
    ['file.upload', '上传本机文件'],
  ])('uses a readable title for %s', (toolName, title) => {
    expect(getAgentToolNameTitle(toolName)).toBe(title);
  });

  it('shows preparation as an active state instead of a failure', () => {
    const activity = completedActivity('media.extractAudio', {});
    activity.status = 'preparing';
    activity.result = undefined;

    expect(buildAgentToolPresentation(activity, 3)).toEqual([{
      label: '正在准备执行目标',
      tone: 'info',
      type: 'status',
    }]);
  });

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

  it('keeps Shell result metadata and output out of the generic presentation registry', () => {
    const blocks = buildAgentToolPresentation(completedActivity('shell.run', {
      durationMs: 13,
      exitCode: 0,
      status: 'completed',
      stderrTail: 'private stderr',
      stdoutTail: 'private stdout',
      previewTruncated: true,
    }), 3);

    expect(blocks).toEqual([{ message: '完成', tone: 'success', type: 'notice' }]);
    expect(JSON.stringify(blocks)).not.toContain('durationMs');
    expect(JSON.stringify(blocks)).not.toContain('exitCode');
    expect(JSON.stringify(blocks)).not.toContain('private stderr');
    expect(JSON.stringify(blocks)).not.toContain('private stdout');
    expect(JSON.stringify(blocks)).not.toContain('previewTruncated');
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

function renameActivity(): AgentToolActivitySnapshot {
  const operationId = 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68';
  return { ...completedActivity('example.rename.propose', {
    operationId, mutationCommitState: 'committed', items: [{ nodeId: 11, parentId: 10, name: 'new', ext: 'txt' }],
  }), pluginSource: { pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64), toolId: 'example.rename.propose', registrationId: `plugin-tool:${'b'.repeat(64)}` },
  preparation: { preparedActionId: 'prepared', snapshotHash: 'c'.repeat(64), action: {
    kind: 'plugin.rename', version: 1, libraryId: 3, operationId, pluginId: 'example.rename', pluginVersion: '0.1.0', packageFingerprint: 'a'.repeat(64),
    items: [{ nodeId: 11, parentId: 10, oldName: 'old.txt', newName: 'new.txt' }],
  } } };
}

describe('plugin rename receipt presentation', () => {
  it('shows host-recorded source and the matching committed receipt without exposing arbitrary fields', () => {
    const activity = renameActivity();
    activity.result!.data = { ...(activity.result!.data as object), source: 'forged plugin', secretUrl: 'https://example.invalid/private' };
    const blocks = buildAgentToolPresentation(activity, 3);
    expect(blocks).toContainEqual({ type: 'details', title: '提交回执', entries: [
      { label: '操作 ID', value: 'eaf4604e-5779-4a3c-8c3d-3eaf45c9aa68' }, { label: '提交状态', value: '已提交' },
    ] });
    expect(JSON.stringify(blocks)).toContain('example.rename');
    expect(JSON.stringify(blocks)).not.toContain('forged plugin'); expect(JSON.stringify(blocks)).not.toContain('secretUrl');
  });

  it.each(['uncommitted', 'commit_unknown'] as const)('preserves %s after failure or cancellation', state => {
    for (const status of ['failed', 'cancelled', 'interrupted'] as const) {
      const activity = renameActivity(); activity.status = status;
      activity.result = { ok: false, data: { ...(activity.result!.data as object), mutationCommitState: state } };
      const blocks = buildAgentToolPresentation(activity, 3);
      expect(JSON.stringify(blocks)).toContain(state === 'uncommitted' ? '未提交' : '尚不能确认，请查询回执');
      expect(blocks).not.toContainEqual(expect.objectContaining({ tone: 'success' }));
    }
  });

  it('does not label mismatched, failed or malformed claimed receipts as committed', () => {
    for (const change of [{ operationId: 'other' }, { items: [] }, { items: [{ nodeId: 99, parentId: 10, name: 'new', ext: 'txt' }] }]) {
      const activity = renameActivity(); activity.result!.data = { ...(activity.result!.data as object), ...change };
      expect(JSON.stringify(buildAgentToolPresentation(activity, 3))).toContain('尚不能确认，请查询回执');
    }
    const failed = renameActivity(); failed.status = 'failed'; failed.result!.ok = false;
    expect(JSON.stringify(buildAgentToolPresentation(failed, 3))).toContain('尚不能确认，请查询回执');
    const mismatchedFailure = renameActivity(); mismatchedFailure.result!.data = { ...(mismatchedFailure.result!.data as object), mutationCommitState: 'uncommitted' };
    expect(JSON.stringify(buildAgentToolPresentation(mismatchedFailure, 3))).toContain('尚不能确认，请查询回执');
  });

  it('does not fabricate a rename receipt from result fields, foreign sources or another library', () => {
    const activity = renameActivity();
    for (const invalid of [{ ...activity, pluginSource: undefined }, { ...activity, preparation: undefined },
      { ...activity, pluginSource: { ...activity.pluginSource!, pluginVersion: '9.0.0' } }]) {
      expect(buildAgentToolPresentation(invalid, 3)).not.toContainEqual(expect.objectContaining({ title: '提交回执' }));
    }
    expect(buildAgentToolPresentation(activity, 4)).not.toContainEqual(expect.objectContaining({ title: '提交回执' }));
  });
});
