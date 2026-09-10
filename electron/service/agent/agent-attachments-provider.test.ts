import { describe, expect, it } from 'vitest';
import { buildAgentProviderRequestBody, type AgentProviderTurnInput } from './agent-provider-model';
import { estimateAgentProviderMessagesTokens } from './agent-context-projection';
import { attachmentManifest } from '../../../src/shared/agent/agent-attachments';

const images = ['data:image/png;base64,YQ==', 'data:image/png;base64,Yg=='];
const attachments = images.map((_, index) => ({ id: `${index}`, name: `${index}.png`, kind: 'image' as const, mimeType: 'image/png', sizeBytes: 1 }));
const input: AgentProviderTurnInput = { model: 'gpt-5.5', systemPrompt: 'rules', maxOutputTokens: 1000, tools: [],
  messages: [{ role: 'user', content: '比较两张图' + attachmentManifest(attachments), attachments, images }] };
describe('attachment provider payloads', () => {
  it('delivers tool-generated images after all OpenAI tool replies and inside Claude tool results', () => {
    const turn: AgentProviderTurnInput = { ...input, tools: [{ name: 'attachment.view', description: 'view', inputSchema: { type: 'object' } }], messages: [
      { role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'attachment.view', input: {} }, { id: 'b', name: 'attachment.view', input: {} }] },
      { role: 'tool', name: 'attachment.view', toolCallId: 'a', content: 'page one', images: [images[0]], attachments: [attachments[0]] },
      { role: 'tool', name: 'attachment.view', toolCallId: 'b', content: 'page two', images: [images[1]], attachments: [attachments[1]] },
    ] };
    const openai = buildAgentProviderRequestBody({ providerType: 'openai', baseUrl: 'https://test.invalid', apiKey: 'test' }, turn) as any;
    expect(openai.messages.map((message: any) => message.role)).toEqual(['system', 'assistant', 'tool', 'tool', 'user']);
    expect(openai.messages[4].content.filter((item: any) => item.type === 'image_url').map((item: any) => item.image_url.url)).toEqual(images);
    const claude = buildAgentProviderRequestBody({ providerType: 'claude', baseUrl: 'https://test.invalid', apiKey: 'test' }, turn) as any;
    expect(claude.messages[1].content.map((result: any) => result.tool_use_id)).toEqual(['a', 'b']);
    expect(claude.messages[1].content[0].content[1]).toMatchObject({ type: 'image', source: { data: 'YQ==' } });
  });
  it('sends actual ordered image bytes to OpenAI and Claude instead of filesystem paths', () => {
    const openai = buildAgentProviderRequestBody({ providerType: 'openai', baseUrl: 'https://test.invalid/v1', apiKey: 'test' }, input) as any;
    expect(openai.messages[1].content.filter((part: any) => part.type === 'image_url').map((part: any) => part.image_url.url)).toEqual(images);
    const claude = buildAgentProviderRequestBody({ providerType: 'claude', baseUrl: 'https://test.invalid/v1', apiKey: 'test' }, { ...input, model: 'claude-sonnet-4-5' }) as any;
    expect(claude.messages[0].content.filter((part: any) => part.type === 'image').map((part: any) => part.source.data)).toEqual(['YQ==', 'Yg==']);
  });
  it('budgets vision separately from encoded bytes and fails visibly for a known text-only model', () => {
    const textTokens = estimateAgentProviderMessagesTokens([{ role: 'user', content: input.messages[0].content }]);
    expect(estimateAgentProviderMessagesTokens(input.messages) - textTokens).toBe(8192);
    expect(() => buildAgentProviderRequestBody({ providerType: 'deepseek', baseUrl: 'https://test.invalid/v1', apiKey: 'test' }, { ...input, model: 'deepseek-chat' })).toThrow('不支持图片');
  });
});
