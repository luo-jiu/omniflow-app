import { describe, expect, it, vi } from 'vitest';

const { completeWithAIService } = vi.hoisted(() => ({
  completeWithAIService: vi.fn().mockResolvedValue('translated'),
}));

vi.mock('@/features/ai-services/ai-service.api', () => ({
  beginAIServiceRun: vi.fn(),
  completeWithAIService,
  endAIServiceRun: vi.fn(),
  fetchActiveAIServiceModels: vi.fn(),
}));

import {
  loadSubtitleFromDroppedFile,
  MAX_DROPPED_SUBTITLE_FILE_BYTES,
  selectSingleDroppedSubtitleFile,
  translateSubtitleRow,
} from './subtitle-translation.service';

const SRT_CONTENT = `1
00:00:01,000 --> 00:00:02,000
Hello
`;

const VTT_CONTENT = `WEBVTT

00:00:01.000 --> 00:00:02.000
Hello
`;

function createFile(name: string, content: string, size = content.length): File {
  return {
    name,
    size,
    text: vi.fn().mockResolvedValue(content),
  } as unknown as File;
}

describe('selectSingleDroppedSubtitleFile', () => {
  it('只接受单个字幕文件', () => {
    const file = createFile('sample.srt', SRT_CONTENT);

    expect(selectSingleDroppedSubtitleFile([file])).toBe(file);
    expect(() => selectSingleDroppedSubtitleFile([])).toThrow('未读取到可用的本地文件');
    expect(() => selectSingleDroppedSubtitleFile([file, file])).toThrow('一次只能拖入一个字幕文件');
  });

  it('在读取内容前拒绝超出上限的字幕文件', () => {
    const file = createFile('huge.srt', SRT_CONTENT, MAX_DROPPED_SUBTITLE_FILE_BYTES + 1);

    expect(() => selectSingleDroppedSubtitleFile([file])).toThrow('拖入字幕文件不能超过 20 MB');
    expect(file.text).not.toHaveBeenCalled();
  });
});

describe('loadSubtitleFromDroppedFile', () => {
  it.each([
    ['sample.srt', SRT_CONTENT, 'srt'],
    ['SAMPLE.VTT', VTT_CONTENT, 'vtt'],
  ] as const)('读取并解析拖入的 %s 字幕', async (name, content, format) => {
    const result = await loadSubtitleFromDroppedFile(createFile(name, content));

    expect(result.fileFormat).toBe(format);
    expect(result.fileName).toBe(name);
    expect(result.filePath).toBe('');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].sourceText).toBe('Hello');
  });

  it('拒绝非字幕扩展名且不读取内容', async () => {
    const file = createFile('notes.txt', SRT_CONTENT);

    await expect(loadSubtitleFromDroppedFile(file)).rejects.toThrow('当前仅支持拖入 SRT 或 VTT 字幕文件');
    expect(file.text).not.toHaveBeenCalled();
  });

  it('保留解析器对伪字幕内容的错误', async () => {
    await expect(loadSubtitleFromDroppedFile(
      createFile('broken.srt', 'not a subtitle'),
    )).rejects.toThrow('未识别到有效字幕片段');
  });

  it('直接调用读取服务时也拒绝超出上限的文件', async () => {
    const file = createFile('huge.vtt', VTT_CONTENT, MAX_DROPPED_SUBTITLE_FILE_BYTES + 1);

    await expect(loadSubtitleFromDroppedFile(file)).rejects.toThrow('拖入字幕文件不能超过 20 MB');
    expect(file.text).not.toHaveBeenCalled();
  });
});

describe('translateSubtitleRow', () => {
  it('only uses the preset prompt to specify the target language', async () => {
    await translateSubtitleRow({
      contextWindow: 0,
      model: 'model-a',
      presetPrompt: '请翻译成日语。',
      reasoningEffort: 'auto',
    }, [{
      endMs: 2000,
      endTimestamp: '00:00:02,000',
      id: '1',
      index: 1,
      sourceText: 'Hello',
      startMs: 1000,
      startTimestamp: '00:00:01,000',
      status: 'idle',
      translatedText: '',
    }], 0, 'profile-id', 'run-session-id');

    expect(completeWithAIService).toHaveBeenCalledWith(expect.objectContaining({
      runSessionId: 'run-session-id',
      systemPrompt: expect.stringContaining('请翻译成日语。'),
    }));
    const request = completeWithAIService.mock.calls.at(-1)?.[0];
    expect(request?.userPrompt).not.toContain('日语');
    expect(request?.userPrompt).not.toContain('简体中文');
  });
});
