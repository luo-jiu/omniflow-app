import { describe, expect, it } from 'vitest';

import type { AgentTool } from './agent-tool-registry';
import { agentPlanControlTool } from './agent-plan-model';
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
      maxOutputTokens: 2_048,
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
      max_completion_tokens: 2_048,
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
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('groups Claude tool results into the next user message', () => {
    const body = buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.anthropic.com/v1',
      providerType: 'claude',
    }, {
      maxOutputTokens: 3_072,
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
    expect(body.max_tokens).toBe(3_072);
    expect(body).not.toHaveProperty('max_completion_tokens');
  });

  it.each(['deepseek', 'local'] as const)(
    'uses the compatible max_tokens field for %s Agent requests',
    (providerType) => {
      const body = buildAgentProviderRequestBody({
        apiKey: 'secret',
        baseUrl: 'https://api.example/v1',
        providerType,
      }, {
        maxOutputTokens: 1_536,
        messages: [{ content: '查看当前目录', role: 'user' }],
        model: 'test-model',
        systemPrompt: 'system',
        tools: [fileListTool],
      });

      expect(body.max_tokens).toBe(1_536);
      expect(body).not.toHaveProperty('max_completion_tokens');
    },
  );

  it('carries provider-only control calls without requiring a business Tool', () => {
    const messages = [
      {
        content: '',
        role: 'assistant' as const,
        toolCalls: [{
          id: 'call-plan',
          input: {
            steps: [
              { title: '读取目录', toolName: 'file.list' },
              { title: '检查文件', toolName: 'file.stat' },
            ],
          },
          name: 'agent.plan.set',
        }],
      },
      {
        content: '{"ok":true}',
        name: 'agent.plan.set',
        role: 'tool' as const,
        toolCallId: 'call-plan',
      },
    ];
    const openAI = buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai',
    }, {
      maxOutputTokens: 1_024,
      messages,
      model: 'gpt-5-mini',
      systemPrompt: 'system',
      tools: [agentPlanControlTool],
    });
    const claude = buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.anthropic.com/v1',
      providerType: 'claude',
    }, {
      maxOutputTokens: 1_024,
      messages,
      model: 'claude-sonnet-4-5',
      systemPrompt: 'system',
      tools: [agentPlanControlTool],
    });

    expect((openAI.tools as Array<Record<string, any>>)[0]).toMatchObject({
      function: { name: 'agent_plan_set' },
      type: 'function',
    });
    expect((openAI.messages as Array<Record<string, any>>).slice(-2)).toEqual([
      expect.objectContaining({
        tool_calls: [expect.objectContaining({
          function: expect.objectContaining({ name: 'agent_plan_set' }),
          id: 'call-plan',
        })],
      }),
      { content: '{"ok":true}', role: 'tool', tool_call_id: 'call-plan' },
    ]);
    expect((claude.tools as Array<Record<string, any>>)[0]).toMatchObject({
      name: 'agent_plan_set',
    });
    expect((claude.messages as Array<Record<string, any>>).slice(-2)).toEqual([
      expect.objectContaining({
        content: [expect.objectContaining({ id: 'call-plan', name: 'agent_plan_set' })],
        role: 'assistant',
      }),
      {
        content: [{ content: '{"ok":true}', tool_use_id: 'call-plan', type: 'tool_result' }],
        role: 'user',
      },
    ]);
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

  it('rejects assistant content before an oversized delta is accumulated', () => {
    const state = createAgentProviderStreamState({ maxAssistantContentCharacters: 5 });
    expect(consumeAgentProviderStreamEvent('openai', {
      choices: [{ delta: { content: '12345' } }],
    }, state)).toBe('12345');

    expect(() => consumeAgentProviderStreamEvent('openai', {
      choices: [{ delta: { content: '6'.repeat(100) } }],
    }, state)).toThrow('Agent 回答超过安全上限');
    expect(state.content).toBe('12345');
  });

  it('rejects Tool argument fragments before either per-call or total limits are exceeded', () => {
    const perCallState = createAgentProviderStreamState({
      maxToolArgumentCharacters: 5,
      maxToolArgumentTotalCharacters: 10,
    });
    consumeAgentProviderStreamEvent('openai', {
      choices: [{ delta: { tool_calls: [{
        function: { arguments: '12345', name: 'file_stat' },
        id: 'call-1',
        index: 0,
      }] } }],
    }, perCallState);
    expect(() => consumeAgentProviderStreamEvent('openai', {
      choices: [{ delta: { tool_calls: [{
        function: { arguments: '6'.repeat(100) },
        index: 0,
      }] } }],
    }, perCallState)).toThrow('Agent Tool 参数超过安全上限');

    const totalState = createAgentProviderStreamState({
      maxToolArgumentCharacters: 10,
      maxToolArgumentTotalCharacters: 6,
    });
    consumeAgentProviderStreamEvent('openai', {
      choices: [{ delta: { tool_calls: [{
        function: { arguments: '123', name: 'file_list' },
        id: 'call-1',
        index: 0,
      }] } }],
    }, totalState);
    expect(() => consumeAgentProviderStreamEvent('openai', {
      choices: [{ delta: { tool_calls: [{
        function: { arguments: '4567' },
        id: 'call-2',
        index: 1,
      }] } }],
    }, totalState)).toThrow('Agent Tool 参数总量超过安全上限');
  });

  it('keeps bounded unknown Tool calls representable in provider history', () => {
    const body = buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai',
    }, {
      maxOutputTokens: 1_024,
      messages: [
        {
          content: '',
          role: 'assistant',
          toolCalls: [{ id: 'unknown-call', input: { safe: true }, name: 'unknown.tool' }],
        },
        {
          content: '{"message":"Tool 不存在","ok":false}',
          name: 'unknown.tool',
          role: 'tool',
          toolCallId: 'unknown-call',
        },
      ],
      model: 'gpt-test',
      systemPrompt: 'system',
      tools: [fileListTool],
    });

    expect((body.messages as Array<Record<string, any>>)[1].tool_calls[0].function.name)
      .toBe('unknown_tool');
  });

  it('only emits provider-compatible names in schemas and assistant history', () => {
    const body = buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai',
    }, {
      maxOutputTokens: 1_024,
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
      maxOutputTokens: 1_024,
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

  it('rejects an Agent provider request without an explicit output token limit', () => {
    expect(() => buildAgentProviderRequestBody({
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      providerType: 'openai',
    }, {
      maxOutputTokens: undefined,
      messages: [],
      model: 'gpt-5-mini',
      systemPrompt: 'system',
      tools: [],
    } as never)).toThrow('Agent Provider 请求缺少输出 token 上限');
  });
});
