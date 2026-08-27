import { describe, expect, it } from 'vitest';

import {
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
} from '@/shared/agent/agent.types';
import {
  deriveAgentAudioOutputFileName,
  mediaExtractAudioTool,
  normalizeAgentAudioOutputFormat,
} from './media-extract-audio-tool';

function context(selectedNodeIds: number[] = [8]) {
  const entries = [
    { ext: 'mp4', id: 8, mimeType: 'video/mp4', name: '演示:视频', type: 'file' as const },
    { id: 9, name: '归档', type: 'dir' as const },
  ];
  return {
    appContext: {
      currentDirectory: { id: 10, name: '视频' },
      libraryId: 3,
      platform: 'win32' as const,
      selectedNodeIds,
    },
    onProgress: () => undefined,
    perception: {
      collectedAt: '2026-08-23T00:00:00.000Z',
      currentDirectory: { entries, entryCount: entries.length, id: 10, name: '视频' },
      selectedNodes: entries.filter(node => selectedNodeIds.includes(node.id)),
    },
    signal: new AbortController().signal,
  };
}

describe('media.extractAudio Agent tool', () => {
  it('binds one perceived file to a deterministic current-directory output', async () => {
    const executionContext = context();
    expect(mediaExtractAudioTool.validate?.({ format: 'mp3' }, executionContext)).toEqual({ ok: true });
    expect(mediaExtractAudioTool.createRendererPrepareRequest?.(
      { format: 'mp3' },
      executionContext,
    )).toMatchObject({
      libraryId: 3,
      nodeId: 8,
      outputFormat: 'mp3',
      parentId: 10,
      sourceFileName: '演示:视频.mp4',
    });

    const prepared = await mediaExtractAudioTool.finalizeRendererPreparation?.(
      { format: 'mp3' },
      {
        providerBindings: {
          mp3: {
            providerAlias: 'local-minio',
            providerLabel: '本机 MinIO',
          },
        },
      },
      undefined,
      executionContext,
    );
    expect(prepared).toMatchObject({
      decision: {
        behavior: 'ask',
        preview: {
          description: '将从“演示:视频.mp4”提取音频，并上传到“视频”。',
          title: '提取音频',
        },
      },
      executionInput: {
        conflictPolicy: 'auto_rename',
        destination: 'library',
        fallbackPolicy: 'prompt_local',
        libraryId: 3,
        mimeType: 'video/mp4',
        nodeId: 8,
        outputFileName: '演示_视频-audio.mp3',
        outputFormat: 'mp3',
        parentId: 10,
        sourceFileName: '演示:视频.mp4',
        storageProvider: 'local-minio',
      },
      publicAction: {
        destination: 'library',
        kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
        outputFileName: '演示_视频-audio.mp3',
        outputFormat: 'mp3',
        parentId: 10,
        version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
      },
      snapshotMaterial: { storageProviderBinding: 'local-minio' },
    });
    expect(prepared?.executionInput).not.toHaveProperty('kind');
    expect(prepared?.executionInput).not.toHaveProperty('version');
  });

  it('rejects unsupported formats and unsafe nodes', async () => {
    expect(() => normalizeAgentAudioOutputFormat({ format: 'exe' })).toThrow('只支持');
    expect(mediaExtractAudioTool.validate?.({ nodeId: 9 }, context([])))
      .toMatchObject({ ok: false });
  });

  it('falls back to a canonical local action when library storage is unavailable', async () => {
    const executionContext = context();
    const prepared = await mediaExtractAudioTool.finalizeRendererPreparation?.(
      {},
      { providerBindings: {} },
      undefined,
      executionContext,
    );

    expect(prepared).toMatchObject({
      executionInput: {
        destination: 'local',
        fallbackPolicy: 'none',
        outputFileName: '演示_视频-audio.m4a',
      },
      publicAction: {
        destination: 'local',
        fallbackPolicy: 'none',
        kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
        targetLabel: '本机（执行时选择位置）',
        version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
      },
      snapshotMaterial: { storageProviderBinding: null },
    });
    expect(prepared?.executionInput).not.toHaveProperty('parentId');
    expect(prepared?.executionInput).not.toHaveProperty('storageProvider');
    expect(prepared?.executionInput).not.toHaveProperty('kind');
    expect(prepared?.executionInput).not.toHaveProperty('version');
    expect(prepared?.publicAction).not.toHaveProperty('parentId');
  });

  it('rebinds the physical provider when approval changes the output format', async () => {
    const prepared = await mediaExtractAudioTool.finalizeRendererPreparation?.(
      {},
      {
        providerBindings: {
          m4a: { providerAlias: 'm4a-minio' },
          mp3: { providerAlias: 'mp3-minio' },
        },
      },
      {
        conflictPolicy: 'auto_rename',
        destination: 'library',
        fallbackPolicy: 'prompt_local',
        kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
        libraryId: 3,
        outputFileName: 'custom.mp3',
        outputFormat: 'mp3',
        parentId: 10,
        sourceNodeId: 8,
        targetLabel: '视频',
        version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
      },
      context(),
    );

    expect(prepared).toMatchObject({
      executionInput: { outputFormat: 'mp3', storageProvider: 'mp3-minio' },
      snapshotMaterial: { storageProviderBinding: 'mp3-minio' },
    });
  });

  it('rejects legacy, unknown-version, and extra-field approval actions', () => {
    const rendererResult = {
      providerBindings: {
        m4a: { providerAlias: 'local-minio' },
      },
    };
    const validAction = {
      conflictPolicy: 'auto_rename' as const,
      destination: 'library' as const,
      fallbackPolicy: 'prompt_local' as const,
      kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
      libraryId: 3,
      outputFileName: 'custom.m4a',
      outputFormat: 'm4a' as const,
      parentId: 10,
      sourceNodeId: 8,
      targetLabel: '视频',
      version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
    };
    const legacyAction: Record<string, unknown> = { ...validAction };
    Reflect.deleteProperty(legacyAction, 'kind');

    expect(() => mediaExtractAudioTool.finalizeRendererPreparation?.(
      {},
      rendererResult,
      legacyAction as never,
      context(),
    )).toThrow('类型或版本不受支持');
    expect(() => mediaExtractAudioTool.finalizeRendererPreparation?.(
      {},
      rendererResult,
      { ...validAction, version: 2 } as never,
      context(),
    )).toThrow('类型或版本不受支持');
    expect(() => mediaExtractAudioTool.finalizeRendererPreparation?.(
      {},
      rendererResult,
      { ...validAction, unexpected: true } as never,
      context(),
    )).toThrow('包含未知字段');
  });

  it('derives a Windows-compatible output name without accepting a path', () => {
    expect(deriveAgentAudioOutputFileName('CON.mp4', 'm4a')).toBe('_CON-audio.m4a');
    expect(deriveAgentAudioOutputFileName('folder/name?.mov', 'wav')).toBe('name_-audio.wav');
  });

  it('normalizes long Unicode output names before approval and staging', () => {
    const output = deriveAgentAudioOutputFileName(`${'长'.repeat(100)}.mp4`, 'm4a');

    expect(Buffer.byteLength(output, 'utf8')).toBeLessThanOrEqual(240);
    expect(output.endsWith('-audio.m4a')).toBe(true);
  });
});
