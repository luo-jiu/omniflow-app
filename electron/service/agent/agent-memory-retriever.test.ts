import { describe, expect, it, vi } from 'vitest';

import type { AgentMemoryItem } from '@/shared/agent/agent.types';
import {
  createStructuredAgentMemoryRetriever,
  rankAgentMemoryCandidates,
  shouldSkipAgentMemoryRecall,
} from './agent-memory-retriever';

function memory(
  id: string,
  kind: AgentMemoryItem['kind'],
  title: string,
  content: string,
  updatedAt = '2026-08-23T10:00:00.000Z',
): AgentMemoryItem {
  return {
    application: `处理 ${title} 时`,
    content,
    createdAt: updatedAt,
    id,
    kind,
    ...(kind === 'project' ? { libraryId: 3 } : {}),
    reason: '用户曾明确确认',
    revision: 1,
    scope: kind === 'project' ? 'library' : 'global',
    title,
    updatedAt,
  };
}

describe('Agent memory retriever', () => {
  it('always considers preferences but only recalls relevant project/reference rows', () => {
    const result = rankAgentMemoryCandidates([
      memory('preference', 'preference', '回答风格', '回答保持简洁'),
      memory('audio-project', 'project', '音频输出', '音频统一输出到转换目录'),
      memory('deploy-reference', 'reference', '部署文档', '发布流程说明在内部文档'),
    ], '帮我提取这个视频的音频');

    expect(result.map(item => item.id)).toContain('preference');
    expect(result.map(item => item.id)).toContain('audio-project');
    expect(result.map(item => item.id)).not.toContain('deploy-reference');
  });

  it('does not recall an unrelated project rule just because it belongs to the current library', () => {
    const result = rankAgentMemoryCandidates([
      memory('media-project', 'project', '媒体输出约定', '媒体统一输出到转换目录'),
    ], '帮我写一首诗');

    expect(result).toEqual([]);
  });

  it('deduplicates semantically identical rows with deterministic ordering', () => {
    const result = rankAgentMemoryCandidates([
      memory('older', 'preference', '回答风格', '回答保持简洁', '2026-08-22T10:00:00.000Z'),
      memory('newer', 'preference', '回答风格', '回答保持简洁', '2026-08-23T10:00:00.000Z'),
    ], '请回答');
    expect(result.map(item => item.id)).toEqual(['newer']);
  });

  it('keeps otherwise identical rules when their application contexts differ', () => {
    const first = memory('answering', 'preference', '回答风格', '保持简洁');
    const second = {
      ...memory('reporting', 'preference', '回答风格', '保持简洁'),
      application: '生成审计报告时',
    };
    first.application = '普通回答时';

    expect(rankAgentMemoryCandidates([first, second], '请回答').map(item => item.id))
      .toEqual(['answering', 'reporting']);
  });

  it('treats an explicit ignore request as an empty memory source', async () => {
    const listCandidates = vi.fn(async () => [
      memory('preference', 'preference', '回答风格', '回答保持简洁'),
    ]);
    expect(shouldSkipAgentMemoryRecall('这一轮不要使用长期记忆')).toBe(true);
    expect(shouldSkipAgentMemoryRecall('请记住这个偏好')).toBe(false);
    await expect(createStructuredAgentMemoryRetriever({
      listCandidates,
    }).retrieve({
      libraryId: 3,
      ownerScope: { accountScope: 'user:7', backendScope: 'local' },
      query: 'ignore memory for this request',
    })).resolves.toEqual([]);
    expect(listCandidates).not.toHaveBeenCalled();
  });
});
