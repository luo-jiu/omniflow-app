import { describe, expect, it } from 'vitest';

import { assessAgentToolPermission } from '../agent-permission-gate';
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
    await expect(assessAgentToolPermission(
      mediaExtractAudioTool,
      { format: 'mp3' },
      executionContext,
    )).resolves.toMatchObject({
      behavior: 'ask',
      preview: {
        description: '将从“演示:视频.mp4”提取音频，并上传到“视频”。',
        title: '提取音频',
      },
    });
    expect(mediaExtractAudioTool.createRendererRequest?.(
      { format: 'mp3' },
      executionContext,
    )).toEqual({
      conflictPolicy: 'auto_rename',
      libraryId: 3,
      mimeType: 'video/mp4',
      nodeId: 8,
      outputFileName: '演示_视频-audio.mp3',
      outputFormat: 'mp3',
      parentId: 10,
      sourceFileName: '演示:视频.mp4',
    });
  });

  it('rejects unsupported formats and unsafe nodes', async () => {
    expect(() => normalizeAgentAudioOutputFormat({ format: 'exe' })).toThrow('只支持');
    await expect(assessAgentToolPermission(
      mediaExtractAudioTool,
      { nodeId: 9 },
      context([]),
    )).resolves.toMatchObject({ behavior: 'deny' });
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
