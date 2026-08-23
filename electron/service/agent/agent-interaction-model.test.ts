import { describe, expect, it } from 'vitest';

import {
  normalizeAgentInteractionRequest,
  normalizeAgentInteractionResponse,
} from './agent-interaction-model';

describe('Agent interaction model', () => {
  it('normalizes bounded choice requests and removes duplicate selections', () => {
    const request = normalizeAgentInteractionRequest({
      kind: 'choice',
      multiple: true,
      options: [
        { description: ' 保留原文件 ', id: 'keep', label: ' 保留 ' },
        { id: 'replace', label: '覆盖' },
      ],
      prompt: ' 请选择冲突处理方式 ',
      submitLabel: ' 确认 ',
    });

    expect(request).toEqual({
      kind: 'choice',
      multiple: true,
      options: [
        { description: '保留原文件', id: 'keep', label: '保留' },
        { id: 'replace', label: '覆盖' },
      ],
      prompt: '请选择冲突处理方式',
      submitLabel: '确认',
    });
    expect(normalizeAgentInteractionResponse(request, {
      kind: 'choice',
      selectedOptionIds: ['keep', 'keep', 'replace'],
    })).toEqual({ kind: 'choice', selectedOptionIds: ['keep', 'replace'] });
  });

  it('rejects duplicate or invalid choice options', () => {
    expect(() => normalizeAgentInteractionRequest({
      kind: 'choice',
      options: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }],
      prompt: '请选择',
    })).toThrow('选择项 ID 不能重复');

    const request = normalizeAgentInteractionRequest({
      kind: 'choice',
      options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      prompt: '请选择',
    });
    expect(() => normalizeAgentInteractionResponse(request, {
      kind: 'choice',
      selectedOptionIds: ['a', 'b'],
    })).toThrow('只能选择一个');
    expect(() => normalizeAgentInteractionResponse(request, {
      kind: 'choice',
      selectedOptionIds: ['unknown'],
    })).toThrow('选择项无效');
  });

  it('validates required form fields, numbers and select values', () => {
    const request = normalizeAgentInteractionRequest({
      fields: [
        { id: 'name', label: '文件名', required: true, type: 'text' },
        { id: 'quality', label: '质量', type: 'number' },
        {
          id: 'format',
          label: '格式',
          required: true,
          type: 'select',
          values: [{ id: 'mp3', label: 'MP3' }, { id: 'wav', label: 'WAV' }],
        },
        { id: 'overwrite', label: '允许覆盖', type: 'boolean' },
      ],
      kind: 'form',
      prompt: '补充导出参数',
    });

    expect(normalizeAgentInteractionResponse(request, {
      kind: 'form',
      values: { format: 'mp3', name: 'audio', overwrite: false, quality: 8 },
    })).toEqual({
      kind: 'form',
      values: { format: 'mp3', name: 'audio', overwrite: false, quality: 8 },
    });
    expect(() => normalizeAgentInteractionResponse(request, {
      kind: 'form',
      values: { format: 'mp3' },
    })).toThrow('文件名不能为空');
    expect(() => normalizeAgentInteractionResponse(request, {
      kind: 'form',
      values: { format: 'mp3', name: 'audio', quality: '8' },
    })).toThrow('质量必须是有效数字');
  });

  it('rejects unknown form fields and invalid select values', () => {
    const request = normalizeAgentInteractionRequest({
      fields: [{
        id: 'format',
        label: '格式',
        type: 'select',
        values: [{ id: 'mp3', label: 'MP3' }],
      }],
      kind: 'form',
      prompt: '补充参数',
    });

    expect(() => normalizeAgentInteractionResponse(request, {
      kind: 'form',
      values: { secret: 'unexpected' },
    })).toThrow('表单包含未知字段');
    expect(() => normalizeAgentInteractionResponse(request, {
      kind: 'form',
      values: { format: 'wav' },
    })).toThrow('格式选择值无效');
  });

  it('does not accept inherited properties as form answers', () => {
    const request = normalizeAgentInteractionRequest({
      fields: [{ id: 'name', label: '名称', required: true, type: 'text' }],
      kind: 'form',
      prompt: '请输入名称',
    });
    const values = Object.create({ name: 'inherited' }) as Record<string, unknown>;

    expect(() => normalizeAgentInteractionResponse(request, {
      kind: 'form',
      values,
    })).toThrow('名称不能为空');
  });

  it('rejects secret solicitation including disguised field names before normalization', () => {
    const secretRequests = [
      {
        fields: [{ id: 'a.p.i-k_e_y', label: '连接值', type: 'text' }],
        kind: 'form',
        prompt: '补充连接参数',
      },
      {
        fields: [{ id: 'value', label: '密码', type: 'text' }],
        kind: 'form',
        prompt: '补充连接参数',
      },
      {
        fields: [{ id: 'value', label: '连接值', type: 'text' }],
        kind: 'form',
        prompt: '请粘贴访问令牌',
      },
      {
        kind: 'choice',
        options: [{ id: 'yes', label: '是' }, { id: 'no', label: '否' }],
        prompt: '是否把 Cookie 提供给 Agent？',
      },
    ];

    secretRequests.forEach((request) => {
      expect(() => normalizeAgentInteractionRequest(request))
        .toThrow('交互请求不能索取 API Key、密码、Cookie、令牌、私钥或其他凭据');
    });
  });

  it('does not let sensitive data hide in undeclared interaction properties', () => {
    expect(() => normalizeAgentInteractionRequest({
      fields: [{ id: 'name', label: '名称', type: 'text' }],
      kind: 'form',
      metadata: { apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz' },
      prompt: '补充普通参数',
    })).toThrow('交互请求不能索取');

    expect(() => normalizeAgentInteractionRequest({
      fields: [{ id: 'name', label: '名称', type: 'text' }],
      kind: 'form',
      metadata: 'harmless',
      prompt: '补充普通参数',
    })).toThrow('交互请求包含不允许的字段');
  });

  it('rejects secrets pasted into otherwise safe interaction responses', () => {
    const request = normalizeAgentInteractionRequest({
      fields: [{ id: 'notes', label: '备注', type: 'text' }],
      kind: 'form',
      prompt: '补充备注',
    });

    expect(() => normalizeAgentInteractionResponse(request, {
      kind: 'form',
      values: { notes: 'Authorization: Bearer abcdefghijklmnop' },
    })).toThrow('交互回答不能包含');
  });

  it('rejects undeclared top-level response properties instead of silently discarding them', () => {
    const choiceRequest = normalizeAgentInteractionRequest({
      kind: 'choice',
      options: [{ id: 'yes', label: '是' }, { id: 'no', label: '否' }],
      prompt: '是否继续？',
    });
    expect(() => normalizeAgentInteractionResponse(choiceRequest, {
      apiKey: 'sk-proj-abcdefghijklmnopqrstuvwxyz',
      kind: 'choice',
      selectedOptionIds: ['yes'],
    })).toThrow('交互回答包含不允许的字段');

    const formRequest = normalizeAgentInteractionRequest({
      fields: [{ id: 'name', label: '名称', type: 'text' }],
      kind: 'form',
      prompt: '补充名称',
    });
    expect(() => normalizeAgentInteractionResponse(formRequest, {
      kind: 'form',
      metadata: { token: 'hidden' },
      values: { name: 'example' },
    })).toThrow('交互回答包含不允许的字段');
  });
});
