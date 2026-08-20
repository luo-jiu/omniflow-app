import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SubtitleTranslationConfig, SubtitleTranslationRow } from './types';

const {
  beginSubtitleTranslationRun,
  endSubtitleTranslationRun,
  translateSubtitleRow,
} = vi.hoisted(() => ({
  beginSubtitleTranslationRun: vi.fn(),
  endSubtitleTranslationRun: vi.fn(),
  translateSubtitleRow: vi.fn(),
}));

vi.mock('./subtitle-translation.service', () => ({
  beginSubtitleTranslationRun,
  endSubtitleTranslationRun,
  translateSubtitleRow,
}));

import { subtitleTranslationRunner } from './subtitle-translation.runner';

const CONFIG: SubtitleTranslationConfig = {
  contextWindow: 5,
  model: 'test-model',
  presetPrompt: '',
  reasoningEffort: 'auto',
};

function createRow(id: string, translatedText: string): SubtitleTranslationRow {
  return {
    endMs: 1000,
    endTimestamp: '00:00:01,000',
    id,
    index: Number(id),
    sourceText: `source-${id}`,
    startMs: 0,
    startTimestamp: '00:00:00,000',
    status: translatedText ? 'success' : 'idle',
    translatedText,
  };
}

describe('subtitleTranslationRunner', () => {
  beforeEach(() => {
    subtitleTranslationRunner.stop();
    subtitleTranslationRunner.drainResults(3);
    subtitleTranslationRunner.drainResults(4);
    beginSubtitleTranslationRun.mockReset();
    beginSubtitleTranslationRun.mockResolvedValue('run-session-id');
    endSubtitleTranslationRun.mockReset();
    endSubtitleTranslationRun.mockResolvedValue(true);
    translateSubtitleRow.mockReset();
    translateSubtitleRow.mockImplementation(async (_config, rows, rowIndex) => (
      `translated-${rows[rowIndex].id}`
    ));
  });

  it('默认只处理尚未翻译的字幕', async () => {
    subtitleTranslationRunner.start(
      CONFIG,
      [createRow('1', 'existing'), createRow('2', '')],
      3,
      'profile-id',
    );

    expect(subtitleTranslationRunner.getSnapshot().totalCount).toBe(1);
    await vi.waitFor(() => expect(subtitleTranslationRunner.getSnapshot().running).toBe(false));
    expect(translateSubtitleRow).toHaveBeenCalledTimes(1);
    expect(translateSubtitleRow.mock.calls[0][2]).toBe(1);
    expect(translateSubtitleRow.mock.calls[0][4]).toBe('run-session-id');
    expect(endSubtitleTranslationRun).toHaveBeenCalledWith('run-session-id');
  });

  it('全文重译会处理已有译文和空译文', async () => {
    subtitleTranslationRunner.start(
      CONFIG,
      [createRow('1', 'existing'), createRow('2', '')],
      3,
      'profile-id',
      'all',
    );

    expect(subtitleTranslationRunner.getSnapshot().totalCount).toBe(2);
    await vi.waitFor(() => expect(subtitleTranslationRunner.getSnapshot().running).toBe(false));
    expect(translateSubtitleRow).toHaveBeenCalledTimes(2);
    expect(translateSubtitleRow.mock.calls.map((call) => call[2])).toEqual([0, 1]);
    expect(Array.from(subtitleTranslationRunner.drainResults(3).keys())).toEqual(['1', '2']);
  });

  it('按资料库隔离任务状态和待消费结果', async () => {
    subtitleTranslationRunner.start(CONFIG, [createRow('1', '')], 3, 'profile-id');

    expect(subtitleTranslationRunner.getSnapshot(4)).toMatchObject({
      libraryId: 4,
      running: false,
    });
    await vi.waitFor(() => expect(subtitleTranslationRunner.getSnapshot(3).running).toBe(false));

    expect(subtitleTranslationRunner.drainResults(4).size).toBe(0);
    expect(subtitleTranslationRunner.drainResults(3).get('1')?.translatedText)
      .toBe('translated-1');
  });

  it('订阅方逐次消费结果时不会丢失后续字幕', async () => {
    const received = new Map<string, unknown>();
    const unsubscribe = subtitleTranslationRunner.subscribe(() => {
      subtitleTranslationRunner.drainResults(3).forEach((result, rowId) => {
        received.set(rowId, result);
      });
    });

    try {
      subtitleTranslationRunner.start(
        CONFIG,
        [createRow('1', ''), createRow('2', '')],
        3,
        'profile-id',
      );
      await vi.waitFor(() => expect(subtitleTranslationRunner.getSnapshot(3).running).toBe(false));
      expect(Array.from(received.keys())).toEqual(['1', '2']);
    } finally {
      unsubscribe();
    }
  });

  it('停止任务时立即释放运行会话', async () => {
    let resolveTranslation!: (value: string) => void;
    translateSubtitleRow.mockImplementation(() => new Promise<string>((resolve) => {
      resolveTranslation = resolve;
    }));

    subtitleTranslationRunner.start(CONFIG, [createRow('1', '')], 3, 'profile-id');
    await vi.waitFor(() => expect(translateSubtitleRow).toHaveBeenCalledTimes(1));

    subtitleTranslationRunner.stop(4);
    expect(subtitleTranslationRunner.getSnapshot(3).running).toBe(true);
    expect(endSubtitleTranslationRun).not.toHaveBeenCalled();

    subtitleTranslationRunner.stop(3);
    expect(endSubtitleTranslationRun).toHaveBeenCalledWith('run-session-id');
    resolveTranslation('translated-1');
    await vi.waitFor(() => expect(subtitleTranslationRunner.getSnapshot().running).toBe(false));
  });
});
