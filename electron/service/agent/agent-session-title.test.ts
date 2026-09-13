import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamAIServiceProfile } from '../aiServiceClient';
import { generateAgentSessionTitle, normalizeGeneratedSessionTitle, sessionTitleFromPrompt } from './agent-session-title';

vi.mock('../aiServiceClient', () => ({ streamAIServiceProfile: vi.fn() }));

beforeEach(() => vi.mocked(streamAIServiceProfile).mockReset());

describe('Agent session titles', () => {
  it('keeps the user question as the initial title', () => {
    expect(sessionTitleFromPrompt('  帮我整理\n 当前文件夹  ')).toBe('帮我整理 当前文件夹');
  });

  it('accepts a concise title and rejects multi-line or structured output', () => {
    expect(normalizeGeneratedSessionTitle('标题：“整理测试文件”')).toBe('整理测试文件');
    expect(normalizeGeneratedSessionTitle('标题\n解释')).toBeNull();
    expect(normalizeGeneratedSessionTitle('{"title":"标题"}')).toBeNull();
    expect(normalizeGeneratedSessionTitle('')).toBeNull();
  });

  it('uses a bounded tool-free request with the frozen model connection', async () => {
    const connection = { providerType: 'openai' as const, apiKey: 'test-key', baseUrl: 'https://example.test/v1' };
    const signal = new AbortController().signal;
    vi.mocked(streamAIServiceProfile).mockResolvedValue('整理测试文件');

    expect(await generateAgentSessionTitle({ connection, signal, model: 'model', profileId: 'profile',
      prompt: '整理文件夹', answer: '已完成整理。' })).toBe('整理测试文件');
    expect(streamAIServiceProfile).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model', profileId: 'profile', maxOutputTokens: 256,
      messages: [{ role: 'user', content: JSON.stringify({ question: '整理文件夹', answer: '已完成整理。' }) }],
    }), expect.any(Function), connection, signal, { maxContentCharacters: 512 });
    expect(vi.mocked(streamAIServiceProfile).mock.calls[0][0]).not.toHaveProperty('tools');
  });
});
