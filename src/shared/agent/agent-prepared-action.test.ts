import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
  AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
  AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
  AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
  AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
} from './agent.types';
import {
  equalAgentPreparedActionPublic,
  normalizeAgentPreparedActionPublic,
} from './agent-prepared-action';

function libraryAction(overrides: Record<string, unknown> = {}) {
  return {
    conflictPolicy: 'auto_rename',
    destination: 'library',
    fallbackPolicy: 'prompt_local',
    kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
    libraryId: 3,
    outputFileName: 'movie-audio.m4a',
    outputFormat: 'm4a',
    parentId: 10,
    sourceNodeId: 8,
    targetLabel: '视频',
    version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function fileStageAction(overrides: Record<string, unknown> = {}) {
  return {
    kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
    sourceKind: 'local-picker',
    targetLabel: '当前任务 input 目录',
    version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function libraryFileStageAction(overrides: Record<string, unknown> = {}) {
  return {
    kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
    libraryId: 3,
    sourceDisplayName: 'source.txt',
    sourceIdentity: `sha256:${'b'.repeat(64)}`,
    sourceKind: 'library-node',
    sourceNodeId: 8,
    sourceSizeBytes: 12,
    targetLabel: '当前任务 input 目录',
    version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function localPathFileStageAction(overrides: Record<string, unknown> = {}) {
  return {
    kind: AGENT_FILE_STAGE_PREPARED_ACTION_KIND,
    sourceDisplayName: 'source.txt',
    sourceIdentity: `sha256:${'c'.repeat(64)}`,
    sourceKind: 'local-path',
    sourcePath: '/Users/example/Documents/source.txt',
    sourceSizeBytes: 12,
    targetLabel: '当前任务 input 目录',
    version: AGENT_FILE_STAGE_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function filePublishAction(overrides: Record<string, unknown> = {}) {
  return {
    contentHash: `sha256:${'a'.repeat(64)}`,
    destinationKind: 'local-save-as',
    displayName: 'result.txt',
    kind: AGENT_FILE_PUBLISH_PREPARED_ACTION_KIND,
    sizeBytes: 12,
    sourcePath: 'output/result.txt',
    suggestedFileName: 'result.txt',
    targetLabel: '本机（执行时选择位置）',
    version: AGENT_FILE_PUBLISH_PREPARED_ACTION_VERSION,
    ...overrides,
  };
}

function libraryFilePublishAction(overrides: Record<string, unknown> = {}) {
  return filePublishAction({
    conflictPolicy: 'rename',
    destinationKind: 'library',
    libraryId: 3,
    parentId: 9,
    providerId: 'local',
    targetLabel: '资料库目录“Output” / 本机存储',
    ...overrides,
  });
}

describe('Agent prepared action public contract', () => {
  it('normalizes file.stage and file.publish v1 branches canonically', () => {
    expect(normalizeAgentPreparedActionPublic(fileStageAction({
      targetLabel: '  当前任务 input 目录  ',
    }))).toEqual(fileStageAction());
    expect(normalizeAgentPreparedActionPublic(filePublishAction({
      displayName: ' result.txt ',
      sourcePath: ' output/result.txt ',
      suggestedFileName: ' result.txt ',
      targetLabel: ' 本机（执行时选择位置） ',
    }))).toEqual(filePublishAction());
    expect(normalizeAgentPreparedActionPublic(libraryFileStageAction({
      sourceDisplayName: ' source.txt ',
    }))).toEqual(libraryFileStageAction());
    expect(normalizeAgentPreparedActionPublic(libraryFilePublishAction({
      providerId: ' local ',
    }))).toEqual(libraryFilePublishAction());
  });

  it('normalizes renderer-side local paths without a Node Buffer global', () => {
    vi.stubGlobal('Buffer', undefined);
    try {
      expect(normalizeAgentPreparedActionPublic(localPathFileStageAction({
        sourcePath: ' /Users/example/Documents/字幕.txt ',
      }))).toEqual(localPathFileStageAction({
        sourcePath: '/Users/example/Documents/字幕.txt',
      }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['stage extra field', fileStageAction({ path: '/tmp/private.txt' })],
    ['stage source kind', fileStageAction({ sourceKind: 'library-node' })],
    ['stage mixed local fields', fileStageAction({ libraryId: 3 })],
    ['stage invalid library identity', libraryFileStageAction({ sourceIdentity: 'sha256:bad' })],
    ['stage invalid library ID', libraryFileStageAction({ libraryId: 0 })],
    ['stage invalid node ID', libraryFileStageAction({ sourceNodeId: Number.MAX_SAFE_INTEGER + 1 })],
    ['stage invalid size', libraryFileStageAction({ sourceSizeBytes: -1 })],
    ['publish extra field', filePublishAction({ targetPath: '/tmp/result.txt' })],
    ['publish destination', filePublishAction({ destinationKind: 'library' })],
    ['publish mixed local fields', filePublishAction({ libraryId: 3 })],
    ['publish invalid provider', libraryFilePublishAction({ providerId: '../local' })],
    ['publish invalid library ID', libraryFilePublishAction({ libraryId: 0 })],
    ['publish invalid parent ID', libraryFilePublishAction({ parentId: 0 })],
    ['publish invalid conflict policy', libraryFilePublishAction({ conflictPolicy: 'replace' })],
    ['publish traversal', filePublishAction({ sourcePath: 'output/../private.txt' })],
    ['publish non-output path', filePublishAction({ sourcePath: 'work/result.txt' })],
    ['publish invalid hash', filePublishAction({ contentHash: `sha256:${'A'.repeat(64)}` })],
    ['publish unsafe size', filePublishAction({ sizeBytes: Number.MAX_SAFE_INTEGER + 1 })],
    ['publish unsafe name', filePublishAction({ suggestedFileName: '../result.txt' })],
  ])('rejects malformed file bridge prepared actions: %s', (_label, input) => {
    expect(() => normalizeAgentPreparedActionPublic(input)).toThrow();
  });

  it('normalizes the supported media.extractAudio v1 branch canonically', () => {
    expect(normalizeAgentPreparedActionPublic(libraryAction({
      outputFileName: '  movie-audio.m4a  ',
      outputFormat: ' M4A ',
      targetLabel: '  视频  ',
    }))).toEqual(libraryAction());

    const localAction = libraryAction();
    Reflect.deleteProperty(localAction, 'parentId');
    expect(normalizeAgentPreparedActionPublic({
      ...localAction,
      destination: 'local',
      fallbackPolicy: 'prompt_local',
      targetLabel: '本机（执行时选择位置）',
    })).toEqual({
      conflictPolicy: 'auto_rename',
      destination: 'local',
      fallbackPolicy: 'none',
      kind: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_KIND,
      libraryId: 3,
      outputFileName: 'movie-audio.m4a',
      outputFormat: 'm4a',
      sourceNodeId: 8,
      targetLabel: '本机（执行时选择位置）',
      version: AGENT_MEDIA_EXTRACT_AUDIO_PREPARED_ACTION_VERSION,
    });
  });

  it.each([
    null,
    [],
    'media.extractAudio',
    new Date(0),
  ])('rejects a non-plain root: %s', (input) => {
    expect(() => normalizeAgentPreparedActionPublic(input)).toThrow('无效');
  });

  it.each([
    ['missing kind', libraryAction({ kind: undefined })],
    ['unknown kind', libraryAction({ kind: 'shell.other' })],
    ['missing version', libraryAction({ version: undefined })],
    ['string version', libraryAction({ version: '1' })],
    ['unknown version', libraryAction({ version: 2 })],
  ])('rejects an unsupported discriminator: %s', (_label, input) => {
    expect(() => normalizeAgentPreparedActionPublic(input)).toThrow('类型或版本不受支持');
  });

  it.each([
    ['unknown field', libraryAction({ unexpected: true })],
    ['string library ID', libraryAction({ libraryId: '3' })],
    ['unsafe source ID', libraryAction({ sourceNodeId: Number.MAX_SAFE_INTEGER + 1 })],
    ['unsupported format', libraryAction({ outputFormat: 'flac' })],
    ['invalid destination', libraryAction({ destination: 'remote' })],
    ['invalid fallback policy', libraryAction({ fallbackPolicy: 'always_local' })],
    ['invalid conflict policy', libraryAction({ conflictPolicy: 'overwrite' })],
    ['unsafe file name', libraryAction({ outputFileName: '../movie.m4a' })],
    ['control character in target label', libraryAction({ targetLabel: '视频\n目录' })],
    ['non-string target label', libraryAction({ targetLabel: 10 })],
    ['oversized file name', libraryAction({ outputFileName: 'a'.repeat(256) })],
    ['oversized target label', libraryAction({ targetLabel: 'a'.repeat(501) })],
  ])('rejects a malformed media branch: %s', (_label, input) => {
    expect(() => normalizeAgentPreparedActionPublic(input)).toThrow();
  });

  it('enforces destination-specific parent constraints', () => {
    const libraryWithoutParent = libraryAction();
    Reflect.deleteProperty(libraryWithoutParent, 'parentId');
    expect(() => normalizeAgentPreparedActionPublic(libraryWithoutParent))
      .toThrow('资料库目标目录无效');

    expect(() => normalizeAgentPreparedActionPublic({
      ...libraryAction(),
      destination: 'local',
      fallbackPolicy: 'none',
      targetLabel: '本机（执行时选择位置）',
    })).toThrow('本机目标不能包含资料库目录');
  });

  it('counts Unicode code points consistently with SQLite', () => {
    const outputFileName = `${'😀'.repeat(251)}.m4a`;
    expect(normalizeAgentPreparedActionPublic(libraryAction({ outputFileName })))
      .toMatchObject({ outputFileName });
    expect(() => normalizeAgentPreparedActionPublic(libraryAction({
      outputFileName: `${'😀'.repeat(252)}.m4a`,
    }))).toThrow('输出文件名无效');
  });

  it('compares canonical actions and treats malformed inputs as unequal', () => {
    expect(equalAgentPreparedActionPublic(
      libraryAction({ outputFormat: ' M4A ', targetLabel: ' 视频 ' }),
      libraryAction(),
    )).toBe(true);
    expect(equalAgentPreparedActionPublic(
      libraryAction(),
      libraryAction({ outputFileName: 'renamed.m4a' }),
    )).toBe(false);
    expect(equalAgentPreparedActionPublic(
      libraryAction(),
      libraryAction({ version: 2 }),
    )).toBe(false);
    expect(equalAgentPreparedActionPublic(libraryAction(), null)).toBe(false);
  });
});
