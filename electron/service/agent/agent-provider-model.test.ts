import { describe, expect, it } from 'vitest';

import type { AgentTool } from './agent-tool-registry';
import {
  buildAgentProviderRequestBody,
  consumeAgentProviderStreamEvent,
  createAgentProviderStreamState,
  finalizeAgentProviderToolCalls,
} from './agent-provider-model';

const fileListTool: AgentTool = {
  description: 'List files',
  execute: async () => ({ ok: true }),
  inputSchema: {
    properties: { directoryId: { type: 'integer' } },
    type: 'object',
  },
  name: 'file.list',
  risk: 'read',
};

const fileStatTool: AgentTool = {
  ...fileListTool,
  description: 'Read file metadata',
  name: 'file.stat',
};

describe('agent provider model', () => {
  it('builds OpenAI-compatible tool messages and schemas', () => {
    const body = buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai',
    }, {
      messages: [
        { content: '查看当前目录', role: 'user' },
        {
          content: '',
          role: 'assistant',
          toolCalls: [{ id: 'call-1', input: { directoryId: 3 }, name: 'file.list' }],
        },
        { content: '{"ok":true}', name: 'file.list', role: 'tool', toolCallId: 'call-1' },
      ],
      model: 'gpt-5-mini',
      reasoningEffort: 'high',
      systemPrompt: 'system',
      tools: [fileListTool],
    });

    expect(body).toMatchObject({
      messages: [
        { content: 'system', role: 'system' },
        { content: '查看当前目录', role: 'user' },
        {
          role: 'assistant',
          tool_calls: [{
            function: { arguments: '{"directoryId":3}', name: 'file_list' },
            id: 'call-1',
            type: 'function',
          }],
        },
        { content: '{"ok":true}', role: 'tool', tool_call_id: 'call-1' },
      ],
      stream: true,
      reasoning_effort: 'high',
      tools: [{ function: { name: 'file_list' }, type: 'function' }],
    });
  });

  it('groups Claude tool results into the next user message', () => {
    const body = buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.anthropic.com/v1',
      providerType: 'claude',
    }, {
      messages: [
        { content: '查看文件', role: 'user' },
        {
          content: '我来查看。',
          role: 'assistant',
          toolCalls: [
            { id: 'call-1', input: {}, name: 'file.list' },
            { id: 'call-2', input: { nodeId: 8 }, name: 'file.stat' },
          ],
        },
        { content: '{"ok":true}', name: 'file.list', role: 'tool', toolCallId: 'call-1' },
        { content: '{"ok":true}', name: 'file.stat', role: 'tool', toolCallId: 'call-2' },
      ],
      model: 'claude-sonnet-4-5',
      reasoningEffort: 'medium',
      systemPrompt: 'system',
      tools: [fileListTool, fileStatTool],
    });
    const messages = body.messages as Array<Record<string, any>>;

    expect(messages).toHaveLength(3);
    expect(messages[1].content).toEqual([
      { text: '我来查看。', type: 'text' },
      { id: 'call-1', input: {}, name: 'file_list', type: 'tool_use' },
      { id: 'call-2', input: { nodeId: 8 }, name: 'file_stat', type: 'tool_use' },
    ]);
    expect(messages[2].content).toHaveLength(2);
    expect(body.tools).toEqual([
      {
        description: 'List files',
        input_schema: fileListTool.inputSchema,
        name: 'file_list',
      },
      {
        description: 'Read file metadata',
        input_schema: fileStatTool.inputSchema,
        name: 'file_stat',
      },
    ]);
    expect(body.output_config).toEqual({ effort: 'medium' });
  });

  it('assembles OpenAI tool argument fragments and text deltas', () => {
    const state = createAgentProviderStreamState();
    expect(consumeAgentProviderStreamEvent('deepseek', {
      choices: [{ delta: { content: '先查看。' } }],
    }, state)).toBe('先查看。');
    consumeAgentProviderStreamEvent('deepseek', {
      choices: [{ delta: { tool_calls: [{
        function: { arguments: '{"node', name: 'file_stat' },
        id: 'call-1',
        index: 0,
      }] } }],
    }, state);
    consumeAgentProviderStreamEvent('deepseek', {
      choices: [{ delta: { tool_calls: [{
        function: { arguments: 'Id":8}' },
        index: 0,
      }] } }],
    }, state);

    expect(state.content).toBe('先查看。');
    expect(finalizeAgentProviderToolCalls(state, [fileListTool, fileStatTool])).toEqual([
      { id: 'call-1', input: { nodeId: 8 }, name: 'file.stat' },
    ]);
  });

  it('assembles Claude tool_use input fragments', () => {
    const state = createAgentProviderStreamState();
    consumeAgentProviderStreamEvent('claude', {
      content_block: { id: 'toolu-1', input: {}, name: 'file_list', type: 'tool_use' },
      index: 1,
      type: 'content_block_start',
    }, state);
    consumeAgentProviderStreamEvent('claude', {
      delta: { partial_json: '{"directoryId":3}', type: 'input_json_delta' },
      index: 1,
      type: 'content_block_delta',
    }, state);

    expect(finalizeAgentProviderToolCalls(state, [fileListTool, fileStatTool])).toEqual([
      { id: 'toolu-1', input: { directoryId: 3 }, name: 'file.list' },
    ]);
  });

  it('only emits provider-compatible names in schemas and assistant history', () => {
    const body = buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai',
    }, {
      messages: [{
        content: '',
        role: 'assistant',
        toolCalls: [
          { id: 'call-1', input: {}, name: 'file.list' },
          { id: 'call-2', input: {}, name: 'file.stat' },
        ],
      }],
      model: 'gpt-5-mini',
      systemPrompt: 'system',
      tools: [fileListTool, fileStatTool],
    });
    const schemaNames = (body.tools as Array<Record<string, any>>)
      .map(tool => tool.function.name as string);
    const historyNames = ((body.messages as Array<Record<string, any>>)[1].tool_calls as Array<Record<string, any>>)
      .map(call => call.function.name as string);

    [...schemaNames, ...historyNames].forEach((name) => {
      expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(name.length).toBeLessThanOrEqual(64);
    });
  });

  it('rejects provider-name collisions after sanitizing or truncating tool names', () => {
    const collidingTool = (name: string): AgentTool => ({ ...fileListTool, name });
    const input = (tools: AgentTool[]) => ({
      messages: [],
      model: 'gpt-5-mini',
      systemPrompt: 'system',
      tools,
    });
    const connection = {
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai' as const,
    };

    expect(() => buildAgentProviderRequestBody(
      connection,
      input([collidingTool('file.list'), collidingTool('file_list')]),
    )).toThrow('Agent Tool 名称在 Provider 协议中发生冲突');
    expect(() => buildAgentProviderRequestBody(connection, input([
      collidingTool(`${'a'.repeat(64)}.first`),
      collidingTool(`${'a'.repeat(64)}.second`),
    ]))).toThrow('Agent Tool 名称在 Provider 协议中发生冲突');
  });
});
