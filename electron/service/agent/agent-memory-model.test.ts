import { describe, expect, it } from 'vitest';

import {
  normalizeAgentMemoryEditableFields,
  normalizeAgentMemoryProposal,
} from './agent-memory-model';

describe('Agent memory model', () => {
  it('accepts the three bounded memory kinds and preserves rationale', () => {
    expect(normalizeAgentMemoryProposal({
      application: '以后回答用户时',
      content: '默认使用简体中文并保持简洁',
      kind: 'preference',
      reason: '用户明确要求以后都这样',
      scope: 'global',
      title: '回答语言与篇幅',
    })).toEqual({
      application: '以后回答用户时',
      content: '默认使用简体中文并保持简洁',
      kind: 'preference',
      reason: '用户明确要求以后都这样',
      scope: 'global',
      title: '回答语言与篇幅',
    });
  });

  it('requires project memories to remain inside a library scope', () => {
    expect(() => normalizeAgentMemoryProposal({
      application: '处理项目媒体时',
      content: '输出统一放到转换目录',
      kind: 'project',
      reason: '这是当前资料库约定',
      scope: 'global',
      title: '媒体输出目录',
    })).toThrow('项目记忆必须绑定当前资料库');
  });

  it('rejects secrets at both create and edit boundaries', () => {
    expect(() => normalizeAgentMemoryProposal({
      application: '请求服务时',
      content: 'Authorization: Bearer private-token-value',
      kind: 'reference',
      reason: '方便以后调用',
      scope: 'global',
      title: '服务凭据',
    })).toThrow('长期记忆不能保存');
    expect(() => normalizeAgentMemoryEditableFields({
      application: '请求服务时',
      content: 'api_key=private-value',
      reason: '方便以后调用',
      title: '服务凭据',
    })).toThrow('长期记忆不能保存');
  });
});
